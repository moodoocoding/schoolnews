import { describe, expect, it } from "vitest";

import type { EvidenceItem, TopicCandidate } from "../../src/contracts";
import { RSS_SOURCE_REGISTRY } from "../../src/pipeline/collectors";
import { normalizeArticle } from "../../src/pipeline/normalize";
import { createRssExcerptEvidenceItem } from "../../src/pipeline/retrieval";
import {
  SupabaseContentPersistenceError,
  SupabaseContentPersistenceRepository,
  type SupabaseContentPersistenceRpcDataSource,
  type SupabaseContentPersistenceRpcName,
  type SupabaseContentPersistenceRpcResult,
} from "../../src/repositories/supabase-content-persistence.repository";
import { fingerprintSupabasePipelineArtifactPayload } from "../../src/repositories/supabase-pipeline-workspace.repository";

const RUN = {
  runDate: "2026-08-13",
  runId: "run-20260813",
  leaseToken: "lease-1",
  fence: 2,
  expectedRevision: 7,
} as const;
const source = RSS_SOURCE_REGISTRY[0];
const article = normalizeArticle(
  {
    sourceId: source.sourceId,
    externalId: "news-1",
    originalUrl: "https://www.msit.go.kr/news/1",
    title: "초등학교 AI 교육 안내",
    excerpt:
      "학생과 교사가 AI 결과의 출처와 오류를 함께 확인하고, 수업에서 책임 있게 활용하는 방법을 자세히 안내했습니다.",
    author: null,
    publisher: source.name,
    publishedAt: "2026-08-12T10:00:00+09:00",
    publishedAtPrecision: "instant",
    discoveredAt: "2026-08-13T06:00:00+09:00",
  },
  source,
);
const evidenceResult = createRssExcerptEvidenceItem(article, source);
if (!evidenceResult) throw new Error("evidence fixture expected");
const evidence: EvidenceItem = evidenceResult;

function hash(payload: unknown): string {
  return fingerprintSupabasePipelineArtifactPayload(payload);
}

class FakeDataSource implements SupabaseContentPersistenceRpcDataSource {
  readonly calls: Array<{ name: SupabaseContentPersistenceRpcName; params: Readonly<Record<string, unknown>> }> = [];
  constructor(private readonly handler: (name: SupabaseContentPersistenceRpcName) => SupabaseContentPersistenceRpcResult | Promise<SupabaseContentPersistenceRpcResult>) {}
  async rpc(name: SupabaseContentPersistenceRpcName, params: Readonly<Record<string, unknown>>) {
    this.calls.push({ name, params });
    return this.handler(name);
  }
}

function artifact(outputReference: string, payload: unknown) {
  return {
    outputReference,
    payloadFingerprint: hash(payload),
    configurationFingerprint: "c".repeat(64),
    payload,
  };
}

const collectPayload = {
  kind: "news_ingestion",
  value: { articles: [article], evidenceItems: [evidence], status: "succeeded" },
};
function collectInput() {
  return {
    ...RUN,
    sources: [source],
    articles: [article],
    evidenceItems: [evidence],
    artifact: artifact("workspace.collect.1", collectPayload),
  };
}
const articleMapping = [{ inputArticleId: article.articleId, storedArticleId: article.articleId }];
const evidenceMapping = [{ inputEvidenceId: evidence.evidenceId, storedEvidenceId: evidence.evidenceId }];
const candidate: TopicCandidate = {
  topicId: "topic-20260813",
  articleIds: [article.articleId],
  evidenceIds: [evidence.evidenceId],
  score: {
    total: 78,
    elementaryRelevance: 24,
    aiDigitalSpecificity: 16,
    reliability: 14,
    novelty: 14,
    socialMeaning: 10,
    version: "topic-score-v1",
  },
  independence: {
    qualifyingGroupCount: 1,
    hasPrimaryAndIndependent: false,
    passed: true,
    reasons: ["independent"],
  },
  evidencePolicy: "authoritative_single_source",
  evidencePolicyReason: "공공기관이 직접 발표한 사실입니다.",
  newFactEvidenceIds: [evidence.evidenceId],
  selectionReason: "초등 AI 교육의 새 안내입니다.",
};

async function expectError(operation: Promise<unknown>, code: SupabaseContentPersistenceError["code"], ambiguous = false) {
  await expect(operation).rejects.toMatchObject({ code, ambiguous, retryable: false });
}

describe("SupabaseContentPersistenceRepository", () => {
  it("수집 domain rows와 artifact를 단일 persist_collected_content RPC에 보낸다", async () => {
    const dataSource = new FakeDataSource(() => ({
      data: {
        created: true,
        articleIdMapping: articleMapping,
        evidenceIdMapping: evidenceMapping,
        artifactOutputReference: "workspace.collect.1",
      },
      error: null,
    }));
    const receipt = await new SupabaseContentPersistenceRepository(dataSource)
      .persistCollectedContent(collectInput());
    expect(receipt.created).toBe(true);
    expect(dataSource.calls).toHaveLength(1);
    expect(dataSource.calls[0]).toMatchObject({
      name: "persist_collected_content",
      params: {
        p_run_date: RUN.runDate,
        p_sources: [source],
        p_articles: [article],
        p_evidence_items: [evidence],
        p_artifact_payload: collectPayload,
      },
    });
  });

  it("unknown source, broken evidence lineage와 artifact mismatch를 RPC 전에 차단한다", async () => {
    const dataSource = new FakeDataSource(() => ({ data: null, error: null }));
    const repository = new SupabaseContentPersistenceRepository(dataSource);
    const badSource = collectInput();
    badSource.articles[0] = { ...article, sourceId: "unknown" };
    await expectError(repository.persistCollectedContent(badSource), "INVALID_CONTENT_INPUT");
    const badArtifact = collectInput();
    badArtifact.artifact.payload = { ...collectPayload, value: { articles: [], evidenceItems: [] } };
    badArtifact.artifact.payloadFingerprint = hash(badArtifact.artifact.payload);
    await expectError(repository.persistCollectedContent(badArtifact), "INVALID_CONTENT_INPUT");

    for (const invalidEvidence of [
      { ...evidence, publishedAt: "2026-08-11T10:00:00+09:00" },
      { ...evidence, publishedAtPrecision: "date" as const },
      { ...evidence, authority: "public_authority_direct_fact" as const },
    ]) {
      const badLineage = collectInput();
      badLineage.evidenceItems[0] = invalidEvidence;
      badLineage.artifact.payload = {
        ...collectPayload,
        value: { ...collectPayload.value, evidenceItems: [invalidEvidence] },
      };
      badLineage.artifact.payloadFingerprint = hash(badLineage.artifact.payload);
      await expectError(
        repository.persistCollectedContent(badLineage),
        "INVALID_CONTENT_INPUT",
      );
    }
    expect(dataSource.calls).toHaveLength(0);
  });

  it("canonical mapping remap과 malformed success는 ambiguous fail-closed한다", async () => {
    const remap = new FakeDataSource(() => ({
      data: {
        created: false,
        articleIdMapping: [{ ...articleMapping[0], storedArticleId: "different" }],
        evidenceIdMapping: evidenceMapping,
        artifactOutputReference: "workspace.collect.1",
      },
      error: null,
    }));
    await expectError(
      new SupabaseContentPersistenceRepository(remap).persistCollectedContent(collectInput()),
      "CONTENT_PERSISTENCE_STATE_AMBIGUOUS",
      true,
    );
    const malformed = new FakeDataSource(() => ({ data: { created: true }, error: null }));
    await expectError(
      new SupabaseContentPersistenceRepository(malformed).persistCollectedContent(collectInput()),
      "CONTENT_PERSISTENCE_STATE_AMBIGUOUS",
      true,
    );
  });

  it("선정 topic, relations와 score artifact를 collect parent와 함께 전송한다", async () => {
    const payload = {
      kind: "topic_selection",
      value: { outcome: "eligible", candidate, evidenceItems: [evidence] },
    };
    const dataSource = new FakeDataSource(() => ({
      data: {
        created: true,
        topicId: candidate.topicId,
        topicTitle: article.title,
        articleIds: candidate.articleIds,
        evidenceIds: candidate.evidenceIds,
        artifactOutputReference: "workspace.score.1",
      },
      error: null,
    }));
    const receipt = await new SupabaseContentPersistenceRepository(dataSource).persistSelectedTopic({
      ...RUN,
      topicTitle: article.title,
      candidate,
      articles: [article],
      articleIdMapping: articleMapping,
      evidenceIdMapping: evidenceMapping,
      collectOutputReference: "workspace.collect.1",
      artifact: artifact("workspace.score.1", payload),
    });
    expect(receipt.topicId).toBe(candidate.topicId);
    expect(dataSource.calls[0]).toMatchObject({
      name: "persist_selected_topic",
      params: {
        p_topic_title: article.title,
        p_collect_output_reference: "workspace.collect.1",
        p_artifact_payload: payload,
      },
    });
  });

  it("결정론 title 불일치와 잘못된 mapping은 RPC 전에 차단한다", async () => {
    const payload = { kind: "topic_selection", value: { outcome: "eligible", candidate, evidenceItems: [evidence] } };
    const dataSource = new FakeDataSource(() => ({ data: null, error: null }));
    const repository = new SupabaseContentPersistenceRepository(dataSource);
    const base = {
      ...RUN,
      candidate,
      articles: [article],
      articleIdMapping: articleMapping,
      evidenceIdMapping: evidenceMapping,
      collectOutputReference: "workspace.collect.1",
      artifact: artifact("workspace.score.1", payload),
    };
    await expectError(repository.persistSelectedTopic({ ...base, topicTitle: "다른 제목" }), "INVALID_CONTENT_INPUT");
    await expectError(repository.persistSelectedTopic({
      ...base,
      topicTitle: article.title,
      articleIdMapping: [{ ...articleMapping[0], storedArticleId: "remapped" }],
    }), "INVALID_CONTENT_INPUT");
    expect(dataSource.calls).toHaveLength(0);
  });

  it("후보 없음 score artifact를 별도 원자 RPC로 저장한다", async () => {
    const payload = { kind: "topic_selection", value: { outcome: "none", candidate: null, evidenceItems: [] } };
    const dataSource = new FakeDataSource(() => ({
      data: { created: true, outcome: "none", artifactOutputReference: "workspace.score.none" },
      error: null,
    }));
    await expect(
      new SupabaseContentPersistenceRepository(dataSource).persistEmptyTopicSelection({
        ...RUN,
        collectOutputReference: "workspace.collect.1",
        artifact: artifact("workspace.score.none", payload),
      }),
    ).resolves.toMatchObject({ outcome: "none", created: true });
    expect(dataSource.calls[0].name).toBe("persist_empty_topic_selection");
  });

  it("stable DB error만 노출하고 permission/timeout/unknown은 보수적으로 매핑한다", async () => {
    for (const [error, code, ambiguous] of [
      [{ code: "P0001", message: "ARTICLE_IDENTITY_CONFLICT" }, "ARTICLE_IDENTITY_CONFLICT", false],
      [{ code: "42501", message: "secret details" }, "RPC_PERMISSION_DENIED", false],
      [{ code: "CONTENT_PERSISTENCE_TIMEOUT_AMBIGUOUS" }, "CONTENT_PERSISTENCE_TIMEOUT_AMBIGUOUS", true],
      [{ code: "XX000", message: "secret details" }, "CONTENT_PERSISTENCE_STATE_AMBIGUOUS", true],
    ] as const) {
      const dataSource = new FakeDataSource(() => ({ data: null, error }));
      await expectError(
        new SupabaseContentPersistenceRepository(dataSource).persistCollectedContent(collectInput()),
        code,
        ambiguous,
      );
    }
  });
});
