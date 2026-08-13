import { describe, expect, it } from "vitest";

import type { CollectedArticleFullText } from "../../src/pipeline/collectors";
import {
  buildArticleModelDocuments,
  SupabaseArticleFullTextError,
  SupabaseArticleFullTextRepository,
  type SupabaseArticleFullTextRpcDataSource,
  type SupabaseArticleFullTextRpcName,
  type SupabaseArticleFullTextRpcResult,
} from "../../src/repositories/supabase-article-full-text.repository";
import { validEvidenceItems } from "../fixtures/content/quality";
import { createNaverPublisherSources } from "../../src/pipeline/collectors";

const fullText: CollectedArticleFullText = {
  articleId: "article-1",
  sourceId: "naver-news-yonhap",
  canonicalUrl: "https://www.yna.co.kr/view/example",
  finalUrl: "https://n.news.naver.com/mnews/article/001/0012345678",
  bodyText: "가".repeat(1_200),
  bodySha256: createHash("sha256").update("가".repeat(1_200)).digest("hex"),
  responseBytes: 3_600,
  collectedAt: "2026-08-13T00:00:00.000Z",
  retentionUntil: "2026-09-12T00:00:00.000Z",
  permission: {
    accessReviewedAt: "2026-08-13T00:00:00+09:00",
    policyReferenceUrls: ["https://policy.example/full-text"],
    fullTextUseAllowed: true,
  },
};

class FakeDataSource implements SupabaseArticleFullTextRpcDataSource {
  calls: Array<{ name: SupabaseArticleFullTextRpcName; parameters: Readonly<Record<string, unknown>> }> = [];
  next: SupabaseArticleFullTextRpcResult = { data: null, error: null };
  async rpc(name: SupabaseArticleFullTextRpcName, parameters: Readonly<Record<string, unknown>>) {
    this.calls.push({ name, parameters });
    return this.next;
  }
}

describe("Supabase private 기사 원문 repository", () => {
  it("fenced 쓰기 RPC에 collect lineage와 원문을 전달하고 receipt를 검증한다", async () => {
    const dataSource = new FakeDataSource();
    dataSource.next = {
      data: { createdCount: 1, articleIds: ["article-1"] },
      error: null,
    };
    const repository = new SupabaseArticleFullTextRepository(dataSource);

    await expect(repository.persist({
      runDate: "2026-08-13",
      runId: "run-1",
      leaseToken: "lease-1",
      fence: 2,
      expectedRevision: 4,
      collectOutputReference: "artifact://collect/1",
      fullTexts: [fullText],
    })).resolves.toEqual({ createdCount: 1, articleIds: ["article-1"] });
    expect(dataSource.calls[0]).toMatchObject({
      name: "persist_article_full_texts",
      parameters: {
        p_fence: 2,
        p_expected_revision: 4,
        p_collect_output_reference: "artifact://collect/1",
      },
    });
  });

  it("중복·malformed 입력과 receipt 변조를 fail-closed 처리한다", async () => {
    const dataSource = new FakeDataSource();
    const repository = new SupabaseArticleFullTextRepository(dataSource);
    await expect(repository.persist({
      runDate: "2026-08-13", runId: "run-1", leaseToken: "lease-1",
      fence: 1, expectedRevision: 1, collectOutputReference: "collect",
      fullTexts: [],
    })).rejects.toBeInstanceOf(SupabaseArticleFullTextError);
    await expect(repository.persist({
      runDate: "2026-08-13", runId: "run-1", leaseToken: "lease-1",
      fence: 1, expectedRevision: 1, collectOutputReference: "collect",
      fullTexts: [fullText, fullText],
    })).rejects.toBeInstanceOf(SupabaseArticleFullTextError);

    dataSource.next = { data: { createdCount: 1, articleIds: ["other"] }, error: null };
    await expect(repository.persist({
      runDate: "2026-08-13", runId: "run-1", leaseToken: "lease-1",
      fence: 1, expectedRevision: 1, collectOutputReference: "collect",
      fullTexts: [fullText],
    })).rejects.toMatchObject({ code: "STATE_AMBIGUOUS" });
  });

  it("허용된 article id의 보존기간 내 본문만 읽기 계약으로 반환한다", async () => {
    const dataSource = new FakeDataSource();
    dataSource.next = { data: [{
      articleId: fullText.articleId,
      sourceId: fullText.sourceId,
      canonicalUrl: fullText.canonicalUrl,
      bodyText: fullText.bodyText,
      bodySha256: fullText.bodySha256,
      collectedAt: fullText.collectedAt,
      retentionUntil: fullText.retentionUntil,
      finalUrl: fullText.finalUrl,
      responseBytes: fullText.responseBytes,
      permission: {
        ...fullText.permission,
        policyReferenceUrls: [...fullText.permission.policyReferenceUrls],
      },
    }], error: null };
    const rows = await new SupabaseArticleFullTextRepository(dataSource)
      .getSelected({
        runDate: "2026-08-13", runId: "run-1", leaseToken: "lease-1",
        fence: 2, expectedRevision: 4, scoreOutputReference: "score-ref",
        evidenceIds: ["evidence-1"], articleIds: ["article-1"],
      }, new Date("2026-08-14T00:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(dataSource.calls[0].name).toBe("get_selected_article_full_texts");
    expect(dataSource.calls[0].parameters).toMatchObject({
      p_score_output_reference: "score-ref",
      p_evidence_ids: ["evidence-1"],
    });
  });

  it("조회 응답의 본문 hash 변조와 만료를 애플리케이션 경계에서도 거부한다", async () => {
    const dataSource = new FakeDataSource();
    const row = {
      articleId: fullText.articleId,
      sourceId: fullText.sourceId,
      canonicalUrl: fullText.canonicalUrl,
      bodyText: fullText.bodyText,
      bodySha256: fullText.bodySha256,
      collectedAt: fullText.collectedAt,
      retentionUntil: fullText.retentionUntil,
      finalUrl: fullText.finalUrl,
      responseBytes: fullText.responseBytes,
      permission: {
        ...fullText.permission,
        policyReferenceUrls: [...fullText.permission.policyReferenceUrls],
      },
    };
    const repository = new SupabaseArticleFullTextRepository(dataSource);
    dataSource.next = { data: [], error: null };
    await expect(
      repository.getSelected({
        runDate: "2026-08-13", runId: "run-1", leaseToken: "lease-1",
        fence: 2, expectedRevision: 4, scoreOutputReference: "score-ref",
        evidenceIds: ["evidence-1"], articleIds: ["article-1"],
      }, new Date("2026-08-14T00:00:00Z")),
    ).rejects.toMatchObject({ code: "STATE_AMBIGUOUS" });

    dataSource.next = {
      data: [{ ...row, bodyText: `${row.bodyText}변조` }],
      error: null,
    };
    await expect(
      repository.getSelected({
        runDate: "2026-08-13", runId: "run-1", leaseToken: "lease-1",
        fence: 2, expectedRevision: 4, scoreOutputReference: "score-ref",
        evidenceIds: ["evidence-1"], articleIds: ["article-1"],
      }, new Date("2026-08-14T00:00:00Z")),
    ).rejects.toMatchObject({ code: "STATE_AMBIGUOUS" });

    dataSource.next = { data: [row], error: null };
    await expect(
      repository.getSelected({
        runDate: "2026-08-13", runId: "run-1", leaseToken: "lease-1",
        fence: 2, expectedRevision: 4, scoreOutputReference: "score-ref",
        evidenceIds: ["evidence-1"], articleIds: ["article-1"],
      }, new Date("2026-09-13T00:00:00Z")),
    ).rejects.toMatchObject({ code: "STATE_AMBIGUOUS" });
  });

  it("보존 기한 만료 삭제 receipt의 개수와 식별자를 검증한다", async () => {
    const dataSource = new FakeDataSource();
    dataSource.next = {
      data: { deletedCount: 1, articleIds: ["article-1"] },
      error: null,
    };
    const receipt = await new SupabaseArticleFullTextRepository(dataSource)
      .purgeExpired(100);
    expect(receipt).toEqual({ deletedCount: 1, articleIds: ["article-1"] });
    expect(dataSource.calls[0]).toEqual({
      name: "purge_expired_article_full_texts",
      parameters: { p_limit: 100 },
    });
  });

  it("선정 근거와 원문을 정확히 1:1 결속한 모델 문서로 만든다", () => {
    const evidence = validEvidenceItems()[0];
    const row = {
      articleId: evidence.articleId,
      sourceId: evidence.sourceId,
      canonicalUrl: evidence.url,
      finalUrl: evidence.url,
      bodyText: fullText.bodyText,
      bodySha256: fullText.bodySha256,
      responseBytes: fullText.responseBytes,
      collectedAt: fullText.collectedAt,
      retentionUntil: fullText.retentionUntil,
      permission: {
        ...fullText.permission,
        policyReferenceUrls: [...fullText.permission.policyReferenceUrls],
      },
    };
    const documents = buildArticleModelDocuments({
      evidenceItems: [evidence],
      fullTexts: [row],
    });
    expect(documents[0]).toMatchObject({
      documentKind: "reviewed_full_text",
      articleId: evidence.articleId,
      evidenceId: evidence.evidenceId,
      contentHash: fullText.bodySha256,
      termsReviewedAt: fullText.permission.accessReviewedAt,
    });
    expect(() =>
      buildArticleModelDocuments({ evidenceItems: [evidence], fullTexts: [] }),
    ).toThrow();
  });

  it("네이버 검색 API가 제공한 요약만 별도 문서 유형으로 만든다", () => {
    const source = createNaverPublisherSources().find(
      (candidate) => candidate.sourceId === "naver-summary-donga",
    )!;
    const base = validEvidenceItems()[0];
    const evidence = {
      ...base,
      sourceId: source.sourceId,
      publisherGroupId: source.publisherGroupId,
      sourceRole: source.sourceRole,
      sourceType: source.sourceType,
      sourceName: source.name,
      passage: "AI 에이전트가 사람의 판단과 개인정보 처리 방식에 변화를 만들고 있다는 내용이다.",
      locator: "뉴스 검색 API 요약",
    };
    const now = new Date("2026-08-14T00:00:00.000Z");
    const documents = buildArticleModelDocuments({
      evidenceItems: [evidence],
      fullTexts: [],
      apiSummarySources: [source],
      now,
    });

    expect(documents[0]).toMatchObject({
      documentKind: "licensed_api_summary",
      contentText: evidence.passage,
      rightsBasisUrl: source.policyReferenceUrls[0],
    });
    expect(() =>
      buildArticleModelDocuments({
        evidenceItems: [{ ...evidence, locator: "RSS 요약" }],
        fullTexts: [],
        apiSummarySources: [source],
        now,
      }),
    ).toThrow();
  });
});
import { createHash } from "node:crypto";
