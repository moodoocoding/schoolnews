import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  ArticleInput,
  EvidenceItem,
  GeneratedPost,
  ModelCallAudit,
  PipelineStage,
  PublishedPostDetail,
  SourceCollectionOutcome,
  SourceRegistryEntry,
} from "../../src/contracts";
import { sourceRegistryEntrySchema } from "../../src/contracts";
import { RSS_SOURCE_REGISTRY } from "../../src/pipeline/collectors";
import {
  DeterministicFakeGeneratedPostProvider,
  type ModelInvocationLedger,
} from "../../src/pipeline/generation";
import {
  createSupabaseDailyStages,
  runSupabaseDailyPipeline,
  type PostGenerationSemanticEvaluator,
  type RunSupabaseDailyPipelineOptions,
} from "../../src/pipeline/orchestrator";
import {
  MemoryDailyRunRepository,
  PipelineWorkspaceError,
  SupabaseContentPersistenceError,
  createSupabasePipelineArtifactDescriptor,
  type SupabaseCollectPersistenceInput,
  type SupabaseEmptyTopicPersistenceInput,
  type SupabasePipelineWorkspaceArtifact,
  type SupabasePipelineWorkspaceStoredArtifact,
  type SupabasePublishInput,
  type SupabaseTopicPersistenceInput,
  type SourceAttemptReservation,
} from "../../src/repositories";

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
  maxOutputTokens: 4_000,
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
      "초등학교 수업에서 인공지능 서비스를 사용할 때 개인정보와 안전을 확인하는 지침이 발표됐습니다.",
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
  const summary =
    "두 출처는 초등학교 AI 교육에서 개인정보와 안전을 확인하는 지침을 다룹니다.";
  return {
    title: "초등 AI 수업에서 확인할 개인정보",
    oneLineSummary: {
      sentenceId: "sentence-summary",
      text: summary,
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
            sentenceId: "sentence-context",
            text: "두 자료는 개인정보와 안전 확인 내용을 함께 설명합니다. 수업에서는 입력하지 말아야 할 정보와 이상한 결과를 발견했을 때 알릴 방법을 구체적으로 정해 볼 수 있습니다. 활동이 끝난 뒤에는 지킨 원칙과 다음에 보완할 점을 짧게 정리할 수 있습니다.",
            claimIds: ["claim-context"],
          },
        ],
      },
    ],
    questions: ["AI 수업 전에 개인정보와 안전을 어떻게 확인하면 좋을까요?"],
    claims: [
      {
        claimId: "claim-summary",
        text: summary,
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
        claimId: "claim-context",
        text: "두 자료는 개인정보와 안전 확인 내용을 함께 설명한다.",
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

class FakeWorkspace {
  private readonly byStage = new Map<
    PipelineStage,
    SupabasePipelineWorkspaceStoredArtifact
  >();
  readonly authorities: unknown[] = [];

  commit(input: {
    runId: string;
    stage: PipelineStage;
    configurationFingerprint: string;
    parentOutputReferences: readonly string[];
    artifact: SupabasePipelineWorkspaceArtifact;
  }) {
    const descriptor = createSupabasePipelineArtifactDescriptor(input);
    const stored: SupabasePipelineWorkspaceStoredArtifact = {
      runId: input.runId,
      stage: input.stage,
      kind: input.artifact.kind,
      artifact: structuredClone(input.artifact),
      outputReference: descriptor.outputReference,
      payloadFingerprint: descriptor.payloadFingerprint,
      configurationFingerprint: descriptor.configurationFingerprint,
      parentOutputReferences: descriptor.parentOutputReferences,
    };
    const previous = this.byStage.get(input.stage);
    if (previous && previous.outputReference !== stored.outputReference) {
      throw new PipelineWorkspaceError("OUTPUT_CONFLICT");
    }
    this.byStage.set(input.stage, stored);
    return structuredClone(stored);
  }

  async getArtifactForStage(input: {
    runId: string;
    stage: PipelineStage;
    kind: SupabasePipelineWorkspaceArtifact["kind"];
  }) {
    const stored = this.byStage.get(input.stage);
    if (!stored) return null;
    if (stored.runId !== input.runId || stored.kind !== input.kind) {
      throw new PipelineWorkspaceError("OUTPUT_SCOPE_MISMATCH");
    }
    return structuredClone(stored);
  }

  async getExactArtifactForStage(input: Parameters<FakeWorkspace["commit"]>[0]) {
    const expected = createSupabasePipelineArtifactDescriptor(input);
    const stored = this.byStage.get(input.stage);
    if (!stored) return null;
    if (stored.outputReference !== expected.outputReference) {
      throw new PipelineWorkspaceError("OUTPUT_CONFLICT");
    }
    return structuredClone(stored);
  }

  async getArtifact(reference: string) {
    const stored = [...this.byStage.values()].find(
      (candidate) => candidate.outputReference === reference,
    );
    if (!stored) throw new PipelineWorkspaceError("OUTPUT_NOT_FOUND");
    return structuredClone(stored.artifact);
  }

  async validateOutputReference(reference: string | null) {
    return (
      reference !== null &&
      [...this.byStage.values()].some(
        (candidate) => candidate.outputReference === reference,
      )
    );
  }

  async putArtifactWithAuthority(
    input: Parameters<FakeWorkspace["commit"]>[0],
    authority: unknown,
  ) {
    this.authorities.push(structuredClone(authority));
    const stored = this.commit(input);
    return {
      outputReference: stored.outputReference,
      payloadFingerprint: stored.payloadFingerprint,
      created: true,
    };
  }
}

class FakeContentPersistence {
  readonly collectInputs: SupabaseCollectPersistenceInput[] = [];
  readonly topicInputs: SupabaseTopicPersistenceInput[] = [];
  readonly emptyInputs: SupabaseEmptyTopicPersistenceInput[] = [];
  ambiguousCollect = false;
  ambiguousScore = false;
  ambiguousCollectWithoutCommit = false;

  constructor(private readonly workspace: FakeWorkspace) {}

  async persistCollectedContent(input: SupabaseCollectPersistenceInput) {
    this.collectInputs.push(structuredClone(input));
    if (this.ambiguousCollectWithoutCommit) {
      throw new SupabaseContentPersistenceError(
        "CONTENT_PERSISTENCE_STATE_AMBIGUOUS",
      );
    }
    this.workspace.commit({
      runId: input.runId,
      stage: "collect",
      configurationFingerprint: input.artifact.configurationFingerprint,
      parentOutputReferences: [],
      artifact: input.artifact.payload as SupabasePipelineWorkspaceArtifact,
    });
    if (this.ambiguousCollect) {
      throw new SupabaseContentPersistenceError(
        "CONTENT_PERSISTENCE_STATE_AMBIGUOUS",
      );
    }
    return {
      created: true,
      articleIdMapping: input.articles.map((article) => ({
        inputArticleId: article.articleId,
        storedArticleId: article.articleId,
      })),
      evidenceIdMapping: input.evidenceItems.map((evidence) => ({
        inputEvidenceId: evidence.evidenceId,
        storedEvidenceId: evidence.evidenceId,
      })),
      artifactOutputReference: input.artifact.outputReference,
    };
  }

  async persistSelectedTopic(input: SupabaseTopicPersistenceInput) {
    this.topicInputs.push(structuredClone(input));
    this.workspace.commit({
      runId: input.runId,
      stage: "score",
      configurationFingerprint: input.artifact.configurationFingerprint,
      parentOutputReferences: [input.collectOutputReference],
      artifact: input.artifact.payload as SupabasePipelineWorkspaceArtifact,
    });
    if (this.ambiguousScore) {
      throw new SupabaseContentPersistenceError(
        "CONTENT_PERSISTENCE_STATE_AMBIGUOUS",
      );
    }
    return {
      created: true,
      topicId: input.candidate.topicId,
      topicTitle: input.topicTitle,
      articleIds: [...input.candidate.articleIds],
      evidenceIds: [...input.candidate.evidenceIds],
      artifactOutputReference: input.artifact.outputReference,
    };
  }

  async persistEmptyTopicSelection(input: SupabaseEmptyTopicPersistenceInput) {
    this.emptyInputs.push(structuredClone(input));
    this.workspace.commit({
      runId: input.runId,
      stage: "score",
      configurationFingerprint: input.artifact.configurationFingerprint,
      parentOutputReferences: [input.collectOutputReference],
      artifact: input.artifact.payload as SupabasePipelineWorkspaceArtifact,
    });
    return {
      created: true,
      outcome: "none" as const,
      artifactOutputReference: input.artifact.outputReference,
    };
  }
}

class FakeLedger implements ModelInvocationLedger {
  readonly prepareInputs: Array<
    Parameters<ModelInvocationLedger["prepare"]>[0]
  > = [];
  readonly finalizeInputs: Array<
    Parameters<ModelInvocationLedger["finalize"]>[0]
  > = [];
  private readonly completed = new Map<string, ModelCallAudit>();

  private key(input: {
    purpose: string;
    attemptNumber: number;
    routeAttempt: number;
  }) {
    return `${input.purpose}:${input.attemptNumber}:${input.routeAttempt}`;
  }

  async prepare(input: Parameters<ModelInvocationLedger["prepare"]>[0]) {
    this.prepareInputs.push(structuredClone(input));
    const audit = this.completed.get(this.key(input));
    if (audit) {
      return {
        status: "completed" as const,
        mayInvoke: false as const,
        runId: input.runId,
        callId: input.callId,
        purpose: input.purpose,
        attemptNumber: input.attemptNumber,
        routeAttempt: input.routeAttempt,
        requestFingerprint: input.requestFingerprint,
        audit: structuredClone(audit),
      };
    }
    return {
      status: "prepared" as const,
      mayInvoke: true as const,
      runId: input.runId,
      callId: input.callId,
      purpose: input.purpose,
      attemptNumber: input.attemptNumber,
      routeAttempt: input.routeAttempt,
      requestFingerprint: input.requestFingerprint,
      reservedAt: "2026-08-13T00:00:00.000Z",
    };
  }

  async finalize(input: Parameters<ModelInvocationLedger["finalize"]>[0]) {
    this.finalizeInputs.push(structuredClone(input));
    this.completed.set(this.key(input), structuredClone(input.audit));
    return {
      status: "completed" as const,
      created: true,
      runId: input.runId,
      callId: input.callId,
      purpose: input.purpose,
      attemptNumber: input.attemptNumber,
      routeAttempt: input.routeAttempt,
      requestFingerprint: input.requestFingerprint,
      audit: structuredClone(input.audit),
    };
  }

  async get(input: Parameters<ModelInvocationLedger["get"]>[0]) {
    const audit = this.completed.get(this.key(input));
    if (!audit) return null;
    return {
      status: "completed" as const,
      runId: input.runId,
      callId: audit.callId,
      purpose: input.purpose,
      attemptNumber: input.attemptNumber,
      routeAttempt: input.routeAttempt,
      requestFingerprint: this.finalizeInputs.find(
        (candidate) => this.key(candidate) === this.key(input),
      )!.requestFingerprint,
      reservedAt: "2026-08-13T00:00:00.000Z",
      completedAt: "2026-08-13T00:00:01.000Z",
      audit: structuredClone(audit),
    };
  }
}

function semanticEvaluator(onCall: () => void): PostGenerationSemanticEvaluator {
  return {
    async evaluate(input) {
      onCall();
      return {
        review: {
          passed: true,
          evaluatorVersion: "supabase-fake-evaluator-v1",
          findings: [],
        },
        audit: {
          callId: `semantic-${input.attemptNumber}`,
          attemptNumber: input.attemptNumber,
          purpose: "semantic_review",
          providerId: "supabase-fake-semantic",
          modelId: "supabase-fake-semantic-v1",
          promptVersion: "semantic-evaluator-v1",
          startedAt: "2026-08-13T00:00:00.000Z",
          finishedAt: "2026-08-13T00:00:01.000Z",
          evidenceIds: input.evidenceItems.map((item) => item.evidenceId),
          usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
          estimatedCostUsd: 0,
          finishReason: "stop",
          responseId: null,
        },
      };
    },
  };
}

function setup(sources: readonly SourceRegistryEntry[]) {
  const workspace = new FakeWorkspace();
  const contentPersistence = new FakeContentPersistence(workspace);
  const ledger = new FakeLedger();
  const provider = new DeterministicFakeGeneratedPostProvider({
    post: (request) => postFor(request.evidenceItems),
    metadata: { providerId: "supabase-fake", modelId: "supabase-fake-v1" },
    costEstimator: () => 0,
  });
  let semanticCalls = 0;
  let collectorCalls = 0;
  let receiptCalls = 0;
  const receipts = new Map<string, PublishedPostDetail>();
  const publishInputs: SupabasePublishInput[] = [];
  const options: RunSupabaseDailyPipelineOptions = {
    store: new MemoryDailyRunRepository(),
    workspace,
    contentPersistence,
    sourceAttempt: {
      reserve: async (input: {
        sourceId: string;
        minIntervalMs: number;
      }): Promise<SourceAttemptReservation> => ({
        status: "allowed" as const,
        sourceId: input.sourceId,
        lastAttemptAt: "2026-08-13T00:00:00.000Z",
        nextAllowedAt: new Date(
          Date.parse("2026-08-13T00:00:00.000Z") + input.minIntervalMs,
        ).toISOString(),
      }),
    },
    sources,
    collectSource: async (source: SourceRegistryEntry) => {
      collectorCalls += 1;
      return outcomeFor(source);
    },
    generation: {
      configurationId: "supabase-fake-generation-v1",
      ledger,
      budget: {
        maxModelCalls: 4,
        maxInputTokens: 20_000,
        maxOutputTokens: 2_000,
        maxEstimatedCostUsd: 0.1,
        maxCallSeconds: 30,
      },
      generatedRoutes: [
        {
          provider,
          metadata: {
            providerId: "supabase-fake",
            modelId: "supabase-fake-v1",
          },
          promptVersion: "generated-post-v8-grounded-documents",
          reservationPolicyVersion: "fake-reservation-v1",
          reservation: (request: { maxOutputTokens: number }) => ({
            inputTokens: 500,
            outputTokens: request.maxOutputTokens,
            costUsd: 0,
          }),
        },
      ],
      semanticRoutes: [
        {
          evaluator: semanticEvaluator(() => {
            semanticCalls += 1;
          }),
          providerId: "supabase-fake-semantic",
          modelId: "supabase-fake-semantic-v1",
          promptVersion: "semantic-evaluator-v1",
          reservationPolicyVersion: "fake-reservation-v1",
          reservation: (request: { maxOutputTokens: number }) => ({
            inputTokens: 500,
            outputTokens: request.maxOutputTokens,
            costUsd: 0,
          }),
        },
      ],
      articleFullText: {
        getSelected: async (input) => {
          return input.articleIds.map((articleId) => {
            const bodyText = `테스트 원문 ${articleId} `.repeat(100).trim();
            return {
              articleId,
              sourceId: "test-source",
              canonicalUrl: `https://example.test/${articleId}`,
              finalUrl: `https://example.test/${articleId}`,
              bodyText,
              bodySha256: createHash("sha256").update(bodyText).digest("hex"),
              responseBytes: Buffer.byteLength(bodyText, "utf8"),
              collectedAt: "2026-08-13T00:00:00.000Z",
              retentionUntil: "2027-08-14T00:00:00.000Z",
              permission: {
                accessReviewedAt: "2026-08-13T00:00:00.000Z",
                policyReferenceUrls: ["https://example.test/terms"],
                fullTextUseAllowed: true as const,
              },
            };
            });
        },
      },
      buildArticleDocuments: ({ evidenceItems, fullTexts }) => {
        const catalog = new Map(fullTexts.map((document) => [document.articleId, document]));
        const documents = evidenceItems.map((item) => {
          const document = catalog.get(item.articleId);
          if (!document) throw new Error("TEST_DOCUMENT_NOT_FOUND");
          return {
            documentKind: "reviewed_full_text" as const,
            documentId: `document:${document.bodySha256.slice(0, 32)}`,
            articleId: item.articleId,
            sourceId: item.sourceId,
            evidenceId: item.evidenceId,
            sourceName: item.sourceName,
            title: item.title,
            publishedAt: item.publishedAt,
            contentText: document.bodyText,
            contentHash: document.bodySha256,
            fetchedAt: document.collectedAt,
            retentionExpiresAt: document.retentionUntil,
            rightsBasisUrl: document.permission.policyReferenceUrls[0]!,
            termsReviewedAt: document.permission.accessReviewedAt,
          };
        });
        return documents;
      },
    },
    publisher: {
      publish: async (input: SupabasePublishInput) => {
        publishInputs.push(structuredClone(input));
        receipts.set(input.validationOutputReference, structuredClone(input.post));
        return {
          runDate: input.runDate,
          runId: input.runId,
          revisionId: input.revisionId,
          validationOutputReference: input.validationOutputReference,
          post: structuredClone(input.post),
        };
      },
    },
    publishReceipt: {
      get: async (input: {
        runDate: string;
        runId: string;
        revisionId: string;
        validationOutputReference: string;
      }) => {
        receiptCalls += 1;
        const post = receipts.get(input.validationOutputReference);
        return post ? { ...input, post: structuredClone(post) } : null;
      },
    },
    limits,
    runDate: "2026-08-13",
    ownerId: "supabase-fake-e2e",
  };
  return {
    options,
    workspace,
    contentPersistence,
    ledger,
    provider,
    publishInputs,
    get semanticCalls() {
      return semanticCalls;
    },
    get collectorCalls() {
      return collectorCalls;
    },
    get receiptCalls() {
      return receiptCalls;
    },
  };
}

describe("Supabase fake-only 전체 일일 실행", () => {
  it("dry_run은 수집·선정만 영속화하고 모델·발행 의존성을 요구하지 않는다", async () => {
    const fake = setup([primarySource, independentSource]);

    const result = await runSupabaseDailyPipeline({
      ...fake.options,
      executionMode: "dry_run",
      generation: undefined,
      publisher: undefined,
      publishReceipt: undefined,
    });

    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;
    expect(result.journal.run.steps.map((step) => step.stage)).toEqual([
      "collect",
      "score",
    ]);
    expect(result.journal.run.status).toBe("succeeded_without_publish");
    expect(fake.provider.calls).toHaveLength(0);
    expect(fake.semanticCalls).toBe(0);
    expect(fake.ledger.prepareInputs).toHaveLength(0);
    expect(fake.publishInputs).toHaveLength(0);
    expect(fake.receiptCalls).toBe(0);
  });

  it("collect→score→ledgered generate→validate→publish를 정확한 계보로 실행한다", async () => {
    const fake = setup([primarySource, independentSource]);
    fake.contentPersistence.ambiguousCollect = true;
    fake.contentPersistence.ambiguousScore = true;

    const result = await runSupabaseDailyPipeline(fake.options);

    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;
    expect(
      result.journal.run.status,
      JSON.stringify(result.journal, null, 2),
    ).toBe("succeeded");
    expect(result.journal.run.steps.map((step) => step.stage)).toEqual([
      "collect",
      "score",
      "generate",
      "validate",
      "publish",
    ]);
    expect(result.journal.run.usage).toMatchObject({
      modelCalls: 2,
      hasUnpricedCalls: false,
    });
    expect(fake.collectorCalls).toBe(2);
    expect(fake.contentPersistence.collectInputs).toHaveLength(1);
    expect(fake.contentPersistence.topicInputs).toHaveLength(1);
    expect(fake.provider.calls).toHaveLength(1);
    expect(fake.semanticCalls).toBe(1);
    expect(fake.ledger.prepareInputs).toHaveLength(2);
    expect(fake.ledger.finalizeInputs).toHaveLength(2);
    expect(
      fake.ledger.prepareInputs.every(
        (input) =>
          input.runId === result.journal.run.runId &&
          input.expectedRevision ===
            fake.ledger.prepareInputs[0].expectedRevision,
      ),
    ).toBe(true);
    expect(fake.workspace.authorities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "generate" }),
        expect.objectContaining({ stage: "validate" }),
      ]),
    );
    expect(fake.receiptCalls).toBe(0);
    expect(fake.publishInputs).toHaveLength(1);
    const mutationRevisions = [
      fake.contentPersistence.collectInputs[0].expectedRevision,
      fake.contentPersistence.topicInputs[0].expectedRevision,
      fake.ledger.prepareInputs[0].expectedRevision,
      ...(fake.workspace.authorities as Array<{ expectedRevision: number }>).map(
        (item) => item.expectedRevision,
      ),
      fake.publishInputs[0].expectedRevision,
    ];
    expect(mutationRevisions).toEqual([...mutationRevisions].sort((a, b) => a - b));
  });

  it("독립 근거가 없으면 empty score를 영속화하고 모델과 발행을 호출하지 않는다", async () => {
    const fake = setup([primarySource]);

    const result = await runSupabaseDailyPipeline(fake.options);

    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;
    expect(result.journal.run.status).toBe("succeeded_without_publish");
    expect(result.journal.terminalReason).toBe("NO_ELIGIBLE_TOPIC");
    expect(fake.contentPersistence.emptyInputs).toHaveLength(1);
    expect(fake.provider.calls).toHaveLength(0);
    expect(fake.semanticCalls).toBe(0);
    expect(fake.ledger.prepareInputs).toHaveLength(0);
    expect(fake.receiptCalls).toBe(0);
  });

  it("출처 예약이 거부되면 물리 수집과 이후 모델·발행을 모두 차단한다", async () => {
    const fake = setup([primarySource]);
    fake.options.sourceAttempt.reserve = async (input) => ({
      status: "too_soon" as const,
      code: "TOO_SOON" as const,
      sourceId: input.sourceId,
      lastAttemptAt: "2026-08-13T00:00:00.000Z",
      nextAllowedAt: "2026-08-14T00:00:00.000Z",
    });

    const result = await runSupabaseDailyPipeline(fake.options);

    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;
    expect(result.journal.run.status).toBe("failed");
    expect(result.journal.terminalReason).toBe("SOURCE_UNAVAILABLE");
    expect(fake.collectorCalls).toBe(0);
    expect(fake.provider.calls).toHaveLength(0);
    expect(fake.ledger.prepareInputs).toHaveLength(0);
    expect(fake.receiptCalls).toBe(0);
  });

  it("모호한 collect 커밋을 terminal로 닫지 않고 lease 회수 후 exact artifact만 재사용한다", async () => {
    const fake = setup([primarySource, independentSource]);
    let currentTime = Date.parse("2026-08-12T21:00:00.000Z");
    fake.options.now = () => new Date(currentTime);
    fake.options.leaseDurationMs = 280_000;
    fake.contentPersistence.ambiguousCollectWithoutCommit = true;

    await expect(runSupabaseDailyPipeline(fake.options)).rejects.toMatchObject({
      name: "DailyStageCommitUncertainError",
    });
    const uncertainJournal = await fake.options.store.get("2026-08-13");
    expect(uncertainJournal?.run.status).toBe("running");
    expect(fake.contentPersistence.collectInputs).toHaveLength(1);

    const committed = fake.contentPersistence.collectInputs[0];
    fake.workspace.commit({
      runId: committed.runId,
      stage: "collect",
      configurationFingerprint: committed.artifact.configurationFingerprint,
      parentOutputReferences: [],
      artifact: committed.artifact.payload as SupabasePipelineWorkspaceArtifact,
    });
    fake.contentPersistence.ambiguousCollectWithoutCommit = false;
    currentTime += 280_001;

    const recovered = await runSupabaseDailyPipeline(fake.options);

    expect(recovered.status).toBe("executed");
    expect(
      recovered.status === "executed" && recovered.journal.run.status,
      recovered.status === "executed"
        ? JSON.stringify(recovered.journal, null, 2)
        : JSON.stringify(recovered),
    ).toBe("succeeded");
    expect(fake.contentPersistence.collectInputs).toHaveLength(1);
    expect(fake.collectorCalls).toBe(2);
  });

  it("허용되지 않은 활성 수집원은 예약과 물리 수집 전에 구성을 거부한다", () => {
    const fake = setup([primarySource]);
    const disallowed = {
      ...primarySource,
      accessStatus: "needs_review" as const,
    };

    expect(() =>
      createSupabaseDailyStages({
        ...fake.options,
        sources: [disallowed],
      }),
    ).toThrow();
    expect(fake.collectorCalls).toBe(0);
    expect(fake.ledger.prepareInputs).toHaveLength(0);
  });
});
