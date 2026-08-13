import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  ArticleInput,
  EvidenceItem,
  GeneratedPost,
  SourceCollectionOutcome,
  SourceRegistryEntry,
} from "../../src/contracts";
import {
  articleModelDocumentSchema,
  sourceRegistryEntrySchema,
} from "../../src/contracts";
import { RSS_SOURCE_REGISTRY } from "../../src/pipeline/collectors";
import { DeterministicFakeGeneratedPostProvider } from "../../src/pipeline/generation";
import {
  createMemoryDailyStages,
  runMemoryDailyPipeline,
  type DailyRunStore,
  type PostGenerationSemanticEvaluator,
} from "../../src/pipeline/orchestrator";
import {
  MemoryDailyRunRepository,
  MemoryPipelineWorkspaceRepository,
} from "../../src/repositories";
import { MemoryArticleRepository } from "../../src/repositories/article-memory.repository";

const primarySource = RSS_SOURCE_REGISTRY[0];
const independentSource: SourceRegistryEntry = sourceRegistryEntrySchema.parse({
  ...primarySource,
  sourceId: "independent-school-news",
  name: "독립학교뉴스",
  publisherGroupId: "independent-school-news",
  provenanceGroupPrefix: "independent-school-report",
  feedUrl: "https://independent.example.org/rss.xml",
  siteUrl: "https://independent.example.org/",
  publisherType: "news",
  originType: "original_reporting",
  sourceRole: "independent",
  sourceType: "news",
  authority: "none",
  policyReferenceUrls: ["https://independent.example.org/rss-policy"],
});

const limits = {
  maxModelCalls: 4,
  maxInputTokens: 20_000,
  maxOutputTokens: 2_000,
  maxEstimatedCostUsd: 0.2,
  maxRunSeconds: 300,
} as const;

function articleFor(source: SourceRegistryEntry): ArticleInput {
  return {
    sourceId: source.sourceId,
    externalId: `${source.sourceId}-20260811`,
    originalUrl: `${source.siteUrl}article/elementary-ai-privacy`,
    title: "초등학교 AI 디지털 교육 개인정보 보호 지침 발표",
    excerpt:
      "초등학교 수업에서 인공지능 서비스를 사용할 때 학생의 개인정보와 안전을 확인하는 지침이 발표됐습니다.",
    author: null,
    publisher: source.name,
    publishedAt: "2026-08-11T00:00:00+09:00",
    publishedAtPrecision: "date",
    discoveredAt: "2026-08-13T06:00:00+09:00",
  };
}

function outcomeFor(source: SourceRegistryEntry): SourceCollectionOutcome {
  return {
    sourceId: source.sourceId,
    status: "succeeded",
    startedAt: "2026-08-13T06:00:00+09:00",
    finishedAt: "2026-08-13T06:00:01+09:00",
    items: [articleFor(source)],
    issues: [],
  };
}

function postFor(items: readonly EvidenceItem[]): GeneratedPost {
  const [primary, independent] = items;
  const summaryText =
    "두 출처는 초등학교 AI 교육에서 개인정보와 안전을 확인하는 지침을 다룹니다.";
  return {
    title: "초등 AI 수업에서 확인할 개인정보",
    oneLineSummary: {
      sentenceId: "sentence-summary",
      text: summaryText,
      claimIds: ["claim-summary"],
    },
    body: [
      {
        sentences: [
          {
            sentenceId: "sentence-primary",
            text: `${primary.passage} 수업 목적과 학생에게 필요한 도움을 먼저 살펴보는 과정도 필요합니다. 교사는 사용 전에 학생에게 확인 순서를 설명하고 질문을 받을 수 있습니다.`,
            claimIds: ["claim-primary"],
          },
        ],
      },
      {
        sentences: [
          {
            sentenceId: "sentence-independent",
            text: `${independent.passage} 이 내용을 확인하면 교사와 학생이 AI 사용 전에 안전 원칙을 함께 정할 수 있습니다. 학생은 도구가 내놓은 답과 자신이 확인한 근거를 나란히 기록할 수 있습니다.`,
            claimIds: ["claim-independent"],
          },
        ],
      },
      {
        sentences: [
          {
            sentenceId: "sentence-together",
            text: "두 자료는 학생 개인정보와 안전 확인 내용을 함께 설명합니다. 수업에서는 입력하지 말아야 할 정보와 이상한 결과를 발견했을 때 알릴 방법을 구체적으로 정해 볼 수 있습니다. 활동이 끝난 뒤에는 지킨 원칙과 다음에 보완할 점을 짧게 정리할 수 있습니다.",
            claimIds: ["claim-together"],
          },
        ],
      },
    ],
    questions: ["AI 수업 전에 개인정보와 안전을 어떻게 확인하면 좋을까요?"],
    claims: [
      {
        claimId: "claim-summary",
        text: summaryText,
        kind: "context",
        importance: "key",
        displayCitation: true,
        evidenceRefs: items.map((item) => ({
          evidenceId: item.evidenceId,
          support: "direct" as const,
        })),
      },
      {
        claimId: "claim-primary",
        text: primary.passage,
        kind: "fact",
        importance: "key",
        displayCitation: true,
        evidenceRefs: [{ evidenceId: primary.evidenceId, support: "direct" }],
      },
      {
        claimId: "claim-independent",
        text: independent.passage,
        kind: "fact",
        importance: "key",
        displayCitation: true,
        evidenceRefs: [
          { evidenceId: independent.evidenceId, support: "direct" },
        ],
      },
      {
        claimId: "claim-together",
        text: "두 자료는 학생 개인정보와 안전 확인 내용을 함께 설명한다.",
        kind: "context",
        importance: "supporting",
        displayCitation: false,
        evidenceRefs: items.map((item) => ({
          evidenceId: item.evidenceId,
          support: "context" as const,
        })),
      },
    ],
    usedEvidenceIds: items.map((item) => item.evidenceId),
  };
}

function semanticEvaluator(onCall?: () => void): PostGenerationSemanticEvaluator {
  return {
    async evaluate(input) {
      onCall?.();
      return {
        review: {
          passed: true,
          evaluatorVersion: "memory-e2e-evaluator-v1",
          findings: [],
        },
        audit: {
          callId: `semantic-${input.attemptNumber}`,
          attemptNumber: input.attemptNumber,
          purpose: "semantic_review",
          providerId: "memory-fake-semantic",
          modelId: "memory-fake-semantic-v1",
          promptVersion: "semantic-review-v1",
          startedAt: "2026-08-13T00:00:00.000Z",
          finishedAt: "2026-08-13T00:00:01.000Z",
          evidenceIds: input.evidenceItems.map((item) => item.evidenceId),
          usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
          estimatedCostUsd: 0.001,
          finishReason: "stop",
          responseId: null,
        },
      };
    },
  };
}

function generation(provider: DeterministicFakeGeneratedPostProvider, evaluatorCalls?: () => void) {
  return {
    configurationId: "memory-fake-generation-v1",
    provider,
    semanticEvaluator: semanticEvaluator(evaluatorCalls),
    articleDocumentsForEvidence: (items: readonly EvidenceItem[]) =>
      items.map((item) => {
        const contentText = `${item.articleId} ${item.passage} 디지털 교육 정책과 현장 적용 조건을 확인하기 위한 테스트 원문입니다. `.repeat(20).trim();
        const contentHash = createHash("sha256")
          .update(contentText)
          .digest("hex");
        return articleModelDocumentSchema.parse({
          documentKind: "reviewed_full_text",
          documentId: `document:${contentHash.slice(0, 32)}`,
          articleId: item.articleId,
          sourceId: item.sourceId,
          evidenceId: item.evidenceId,
          sourceName: item.sourceName,
          title: item.title,
          publishedAt: item.publishedAt,
          contentText,
          contentHash,
          fetchedAt: "2026-08-13T00:00:00.000Z",
          retentionExpiresAt: "2027-08-13T00:00:00.000Z",
          rightsBasisUrl: "https://example.test/terms",
          termsReviewedAt: "2026-08-13T00:00:00.000Z",
        });
      }),
    budget: {
      maxModelCalls: 4,
      maxInputTokens: 2_000,
      maxOutputTokens: 1_000,
      maxEstimatedCostUsd: 0.1,
      maxCallSeconds: 30,
    },
  } as const;
}

function provider() {
  return new DeterministicFakeGeneratedPostProvider({
    post: (request) => postFor(request.evidenceItems),
    metadata: { providerId: "memory-fake", modelId: "memory-fake-v1" },
    costEstimator: () => 0.01,
  });
}

describe("M5 메모리 일일 파이프라인 통합", () => {
  it("공식 RSS 한 곳뿐이면 모델을 호출하지 않고 정상 보류한다", async () => {
    const fakeProvider = provider();
    let evaluatorCalls = 0;
    const result = await runMemoryDailyPipeline({
      store: new MemoryDailyRunRepository(),
      workspace: new MemoryPipelineWorkspaceRepository(),
      articleRepository: new MemoryArticleRepository(),
      sources: [primarySource],
      collectSource: async (source) => outcomeFor(source),
      collectionConfigurationId: "single-source-test-v1",
      generation: generation(fakeProvider, () => {
        evaluatorCalls += 1;
      }),
      limits,
      runDate: "2026-08-13",
      ownerId: "memory-e2e-single",
    });

    expect(result.status === "executed" && result.journal.run.status).toBe(
      "succeeded_without_publish",
    );
    expect(result.status === "executed" && result.journal.terminalReason).toBe(
      "NO_ELIGIBLE_TOPIC",
    );
    expect(fakeProvider.calls).toHaveLength(0);
    expect(evaluatorCalls).toBe(0);
  });

  it("최대 모델 제한 시간에도 단계 제한보다 긴 기본 실행권을 계산한다", async () => {
    const fakeProvider = provider();
    const longGeneration = generation(fakeProvider);
    const result = await runMemoryDailyPipeline({
      store: new MemoryDailyRunRepository(),
      workspace: new MemoryPipelineWorkspaceRepository(),
      articleRepository: new MemoryArticleRepository(),
      sources: [primarySource],
      collectSource: async (source) => outcomeFor(source),
      collectionConfigurationId: "long-timeout-test-v1",
      generation: {
        ...longGeneration,
        budget: { ...longGeneration.budget, maxCallSeconds: 300 },
      },
      limits,
      runDate: "2026-08-13",
      ownerId: "memory-e2e-long-timeout",
    });

    expect(result.status === "executed" && result.journal.run.status).toBe(
      "succeeded_without_publish",
    );
    expect(fakeProvider.calls).toHaveLength(0);
  });

  it("생성 설정에 의미 평가기가 없으면 공급자 호출 전에 거부한다", () => {
    const fakeProvider = provider();
    expect(() =>
      createMemoryDailyStages({
        workspace: new MemoryPipelineWorkspaceRepository(),
        articleRepository: new MemoryArticleRepository(),
        generation: {
          ...generation(fakeProvider),
          semanticEvaluator: undefined,
        } as unknown as NonNullable<
          Parameters<typeof createMemoryDailyStages>[0]["generation"]
        >,
      }),
    ).toThrow("독립 의미 평가기");
    expect(fakeProvider.calls).toHaveLength(0);
  });

  it("독립 근거가 있으면 수집부터 검증된 생성물까지 연결하되 게시하지 않는다", async () => {
    const fakeProvider = provider();
    let evaluatorCalls = 0;
    const workspace = new MemoryPipelineWorkspaceRepository();
    const shared = {
      workspace,
      articleRepository: new MemoryArticleRepository(),
      sources: [primarySource, independentSource],
      collectSource: async (source: SourceRegistryEntry) => outcomeFor(source),
      collectionConfigurationId: "two-source-test-v1",
      generation: generation(fakeProvider, () => {
        evaluatorCalls += 1;
      }),
    };
    const result = await runMemoryDailyPipeline({
      ...shared,
      store: new MemoryDailyRunRepository(),
      limits,
      runDate: "2026-08-13",
      ownerId: "memory-e2e-selected",
    });
    expect(result.status === "executed" && result.journal.run.status).toBe(
      "succeeded_without_publish",
    );
    expect(result.status === "executed" && result.journal.terminalReason).toBeNull();
    expect(
      result.status === "executed" &&
        result.journal.attempts.map((attempt) => attempt.stage),
    ).toEqual(["collect", "score", "generate"]);
    expect(result.status === "executed" && result.journal.run.usage.modelCalls).toBe(
      2,
    );
    expect(fakeProvider.calls).toHaveLength(1);
    expect(evaluatorCalls).toBe(1);

    const stages = createMemoryDailyStages(shared);
    const generateStage = stages.find((stage) => stage.stage === "generate");
    const firstOutput =
      result.status === "executed"
        ? result.journal.run.steps.find((step) => step.stage === "generate")
            ?.outputReference
        : null;
    const reused = await generateStage!.execute({
      runId: result.status === "executed" ? result.journal.run.runId : "missing",
      runDate: "2026-08-13",
      stage: "generate",
      attemptNumber: 2,
      signal: new AbortController().signal,
      limits,
      usage: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        hasUnpricedCalls: false,
      },
      leaseToken: "lease-reuse-test",
      leaseFence: 2,
      journalRevision: 1,
    });

    expect(reused.outputReference).toBe(firstOutput);
    expect(reused.usage.modelCalls).toBe(2);
    expect(fakeProvider.calls).toHaveLength(1);
    expect(evaluatorCalls).toBe(1);
  });

  it("생성 설정이 없으면 선정 뒤에도 모델 호출 없이 명시적으로 실패한다", async () => {
    const result = await runMemoryDailyPipeline({
      store: new MemoryDailyRunRepository(),
      workspace: new MemoryPipelineWorkspaceRepository(),
      articleRepository: new MemoryArticleRepository(),
      sources: [primarySource, independentSource],
      collectSource: async (source) => outcomeFor(source),
      collectionConfigurationId: "generation-disabled-test-v1",
      limits,
      runDate: "2026-08-13",
      ownerId: "memory-e2e-disabled",
    });

    expect(result.status === "executed" && result.journal.run.status).toBe(
      "failed",
    );
    expect(result.status === "executed" && result.journal.terminalReason).toBe(
      "INVALID_SOURCE_DATA",
    );
    expect(result.status === "executed" && result.journal.run.usage.modelCalls).toBe(
      0,
    );
  });

  it("생성 산출물 저장 뒤 체크포인트가 끊겨도 모델을 다시 호출하지 않고 사용량을 한 번만 합산한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const workspace = new MemoryPipelineWorkspaceRepository();
    const fakeProvider = provider();
    let evaluatorCalls = 0;
    let currentTime = new Date("2026-08-12T21:00:00.000Z").getTime();
    const now = () => new Date(currentTime);
    let crashOnce = true;
    const crashBeforeGenerationCheckpoint: DailyRunStore = {
      acquireLease: (input) => repository.acquireLease(input),
      checkpoint: async (input) => {
        if (
          crashOnce &&
          input.journal.run.steps.some(
            (step) => step.stage === "generate" && step.status === "succeeded",
          )
        ) {
          crashOnce = false;
          throw new Error("simulated-crash-before-generation-checkpoint");
        }
        return repository.checkpoint(input);
      },
      finish: (input) => repository.finish(input),
      get: (runDate) => repository.get(runDate),
    };
    const shared = {
      workspace,
      articleRepository: new MemoryArticleRepository(),
      sources: [primarySource, independentSource],
      collectSource: async (source: SourceRegistryEntry) => outcomeFor(source),
      collectionConfigurationId: "generation-recovery-test-v1",
      generation: generation(fakeProvider, () => {
        evaluatorCalls += 1;
      }),
      limits,
      runDate: "2026-08-13" as const,
      now,
      leaseDurationMs: 200_000,
    };

    await expect(
      runMemoryDailyPipeline({
        ...shared,
        store: crashBeforeGenerationCheckpoint,
        ownerId: "memory-e2e-crashed",
        createLeaseToken: () => "memory-e2e-crashed-lease",
      }),
    ).rejects.toMatchObject({ code: "STORE_UNAVAILABLE" });
    expect(fakeProvider.calls).toHaveLength(1);
    expect(evaluatorCalls).toBe(1);

    currentTime += 200_001;
    const recovered = await runMemoryDailyPipeline({
      ...shared,
      store: repository,
      ownerId: "memory-e2e-recovered",
      createLeaseToken: () => "memory-e2e-recovered-lease",
    });

    expect(recovered.status === "executed" && recovered.journal.run.status).toBe(
      "succeeded_without_publish",
    );
    expect(
      recovered.status === "executed" && recovered.journal.run.usage.modelCalls,
    ).toBe(2);
    expect(
      recovered.status === "executed" &&
        recovered.journal.attempts
          .filter((attempt) => attempt.stage === "generate")
          .map((attempt) => [attempt.attemptNumber, attempt.errorCode]),
    ).toEqual([
      [1, "LEASE_EXPIRED"],
      [2, null],
    ]);
    expect(fakeProvider.calls).toHaveLength(1);
    expect(evaluatorCalls).toBe(1);
  });
});
