import { describe, expect, it } from "vitest";

import type { ModelCallAudit } from "../../src/contracts";
import {
  createGenerationRequestFingerprint,
  DeterministicFakeGeneratedPostProvider,
  FallbackGeneratedPostProvider,
  GenerationProviderError,
  LedgeredGeneratedPostProvider,
  type ModelInvocationLedger,
  type PrepareModelInvocationReceipt,
  type ReadModelInvocationReceipt,
} from "../../src/pipeline/generation";
import {
  FallbackSemanticEvaluator,
  LedgeredSemanticEvaluator,
  SEMANTIC_EVALUATOR_PROMPT_VERSION,
  type PostGenerationSemanticEvaluator,
} from "../../src/pipeline/orchestrator";
import { GENERATED_POST_PROMPT_VERSION } from "../../src/prompts/generated-post-v2";
import { validEvidenceItems, validGeneratedPost } from "../fixtures/content/quality";

type PrepareInput = Parameters<ModelInvocationLedger["prepare"]>[0];
type FinalizeInput = Parameters<ModelInvocationLedger["finalize"]>[0];
type GetInput = Parameters<ModelInvocationLedger["get"]>[0];

const authority = {
  runDate: "2026-08-13",
  runId: "run-20260813",
  leaseToken: "lease-token-1",
  fence: 3,
  expectedRevision: 7,
};

const request = () => ({
  attemptNumber: 1 as const,
  purpose: "draft" as const,
  evidenceItems: validEvidenceItems(),
  timeoutMs: 1_000,
  maxOutputTokens: 1_200,
  maxPhysicalCalls: 2,
});

class FakeLedger implements ModelInvocationLedger {
  readonly prepareInputs: PrepareInput[] = [];
  readonly finalizeInputs: FinalizeInput[] = [];
  readonly getInputs: GetInput[] = [];
  prepareBehavior:
    | "prepared"
    | "reserved"
    | "completed"
    | "throw" = "prepared";
  completedAudit: ModelCallAudit | null = null;
  getBehavior:
    | ReadModelInvocationReceipt
    | "from-last-completed"
    | "from-last-finalize"
    | "throw" = null;
  finalizeError = false;

  async prepare(input: PrepareInput): Promise<PrepareModelInvocationReceipt> {
    this.prepareInputs.push(structuredClone(input));
    if (this.prepareBehavior === "throw") throw new Error("ambiguous");
    if (this.prepareBehavior === "completed") {
      if (!this.completedAudit) throw new Error("fixture audit required");
      return {
        ...identityFrom(input),
        status: "completed",
        mayInvoke: false,
        audit: auditForInput(this.completedAudit, input),
      };
    }
    return {
      ...identityFrom(input),
      status: this.prepareBehavior,
      mayInvoke: this.prepareBehavior === "prepared",
      reservedAt: "2026-08-13T00:00:00.000Z",
    } as PrepareModelInvocationReceipt;
  }

  async finalize(input: FinalizeInput) {
    this.finalizeInputs.push(structuredClone(input));
    if (this.finalizeError) throw new Error("ambiguous finalize");
    return {
      ...identityFrom(input),
      status: "completed" as const,
      created: true,
      audit: structuredClone(input.audit),
    };
  }

  async get(input: GetInput): Promise<ReadModelInvocationReceipt> {
    this.getInputs.push(structuredClone(input));
    if (this.getBehavior === "throw") throw new Error("ambiguous read");
    if (
      this.getBehavior !== "from-last-completed" &&
      this.getBehavior !== "from-last-finalize"
    ) {
      return structuredClone(this.getBehavior);
    }
    const prepared = this.prepareInputs.at(-1);
    const finalized = this.finalizeInputs.at(-1);
    const audit =
      this.getBehavior === "from-last-finalize"
        ? finalized?.audit
        : this.completedAudit;
    if (!prepared || !audit) return null;
    return {
      ...identityFrom(prepared),
      status: "completed",
      reservedAt: "2026-08-13T00:00:00.000Z",
      completedAt: "2026-08-13T00:00:01.000Z",
      audit: auditForInput(audit, prepared),
    };
  }
}

function identityFrom(input: PrepareInput | FinalizeInput) {
  return {
    runId: input.runId,
    callId: input.callId,
    purpose: input.purpose,
    attemptNumber: input.attemptNumber,
    routeAttempt: input.routeAttempt,
    requestFingerprint: input.requestFingerprint,
  };
}

function auditForInput(
  audit: ModelCallAudit,
  input: PrepareInput,
): ModelCallAudit {
  return {
    ...audit,
    callId: input.callId,
    attemptNumber: input.attemptNumber,
    routeAttempt: input.routeAttempt,
    purpose: input.purpose,
  };
}

function ledgeredProvider(input: {
  ledger: FakeLedger;
  physical: DeterministicFakeGeneratedPostProvider | {
    generate: DeterministicFakeGeneratedPostProvider["generate"];
  };
  routeAttempt?: 1 | 2;
  metadata?: { providerId: string; modelId: string };
  recoveryPost?: ReturnType<typeof validGeneratedPost> | null;
  reservation?: { inputTokens: number; outputTokens: number; costUsd: number };
}) {
  const metadata = input.metadata ?? {
    providerId: "google-gemini",
    modelId: "gemini-primary",
  };
  const recoveryPost = input.recoveryPost;
  return new LedgeredGeneratedPostProvider({
    provider: input.physical,
    ledger: input.ledger,
    authority,
    metadata,
    routeAttempt: input.routeAttempt ?? 1,
    scoreOutputReference: "artifact/score/topic-1",
    reservation: input.reservation ?? {
      inputTokens: 2_000,
      outputTokens: 1_200,
      costUsd: 0.01,
    },
    recovery:
      recoveryPost === undefined
        ? undefined
        : {
            async getCompletedPost() {
              return recoveryPost;
            },
          },
  });
}

async function baseAudit(metadata = {
  providerId: "google-gemini",
  modelId: "gemini-primary",
}) {
  return (
    await new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata,
      costEstimator: () => 0.001,
    }).generate(request())
  ).audit;
}

describe("LedgeredGeneratedPostProvider", () => {
  it("fresh prepare 뒤에만 물리 호출하고 같은 identity로 finalize한다", async () => {
    const ledger = new FakeLedger();
    const physical = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "google-gemini", modelId: "gemini-primary" },
      costEstimator: () => 0.001,
    });
    const result = await ledgeredProvider({ ledger, physical }).generate(
      request(),
    );

    expect(physical.calls).toHaveLength(1);
    expect(ledger.prepareInputs).toHaveLength(1);
    expect(ledger.finalizeInputs).toHaveLength(1);
    expect(ledger.prepareInputs[0]).toMatchObject({
      ...authority,
      purpose: "draft",
      attemptNumber: 1,
      routeAttempt: 1,
      providerId: "google-gemini",
      modelId: "gemini-primary",
      promptVersion: GENERATED_POST_PROMPT_VERSION,
      evidenceIds: ["evidence-1", "evidence-2"],
      reservedInputTokens: 2_000,
      reservedOutputTokens: 1_200,
      reservedCostUsd: 0.01,
    });
    expect(ledger.finalizeInputs[0]).toMatchObject({
      callId: ledger.prepareInputs[0].callId,
      requestFingerprint: ledger.prepareInputs[0].requestFingerprint,
      audit: {
        callId: ledger.prepareInputs[0].callId,
        routeAttempt: 1,
      },
    });
    expect(result.audit.routeAttempt).toBe(1);
  });

  it("fallback의 각 물리 route를 prepare와 finalize에 독립 기록한다", async () => {
    const ledger = new FakeLedger();
    const primaryMetadata = {
      providerId: "google-gemini",
      modelId: "gemini-primary",
    };
    const rejectedAudit = {
      ...(await baseAudit(primaryMetadata)),
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      finishReason: "provider_rate_limited",
      responseId: null,
    };
    const primaryCalls: number[] = [];
    const primary = ledgeredProvider({
      ledger,
      metadata: primaryMetadata,
      physical: {
        async generate() {
          primaryCalls.push(1);
          throw new GenerationProviderError("PROVIDER_RATE_LIMITED", {
            audit: rejectedAudit,
          });
        },
      },
    });
    const fallbackPhysical = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: {
        providerId: "google-gemini",
        modelId: "gemini-fallback",
      },
      costEstimator: () => 0.001,
    });
    const fallback = ledgeredProvider({
      ledger,
      physical: fallbackPhysical,
      routeAttempt: 2,
      metadata: {
        providerId: "google-gemini",
        modelId: "gemini-fallback",
      },
    });

    const result = await new FallbackGeneratedPostProvider([
      primary,
      fallback,
    ]).generate(request());

    expect(primaryCalls).toHaveLength(1);
    expect(fallbackPhysical.calls).toHaveLength(1);
    expect(ledger.prepareInputs.map((input) => input.routeAttempt)).toEqual([
      1, 2,
    ]);
    expect(ledger.finalizeInputs.map((input) => input.routeAttempt)).toEqual([
      1, 2,
    ]);
    expect(result.audits?.map((audit) => audit.routeAttempt)).toEqual([1, 2]);
  });

  it("reserved intent는 물리 공급자를 다시 호출하지 않는다", async () => {
    const ledger = new FakeLedger();
    ledger.prepareBehavior = "reserved";
    const physical = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "google-gemini", modelId: "gemini-primary" },
    });

    await expect(
      ledgeredProvider({ ledger, physical }).generate(request()),
    ).rejects.toMatchObject({
      code: "MODEL_INVOCATION_RECOVERY_REQUIRED",
    });
    expect(physical.calls).toHaveLength(0);
    expect(ledger.finalizeInputs).toHaveLength(0);
  });

  it("completed intent는 저장된 post recovery만 사용하고 재호출하지 않는다", async () => {
    const ledger = new FakeLedger();
    ledger.prepareBehavior = "completed";
    ledger.completedAudit = await baseAudit();
    const physical = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "google-gemini", modelId: "gemini-primary" },
    });

    const result = await ledgeredProvider({
      ledger,
      physical,
      recoveryPost: validGeneratedPost(),
    }).generate(request());

    expect(result.post).toEqual(validGeneratedPost());
    expect(physical.calls).toHaveLength(0);
    expect(ledger.finalizeInputs).toHaveLength(0);
  });

  it("completed audit만 있고 post가 없으면 fail-closed한다", async () => {
    const ledger = new FakeLedger();
    ledger.prepareBehavior = "completed";
    ledger.completedAudit = await baseAudit();
    const physical = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "google-gemini", modelId: "gemini-primary" },
    });

    await expect(
      ledgeredProvider({ ledger, physical }).generate(request()),
    ).rejects.toMatchObject({
      code: "MODEL_INVOCATION_RECOVERY_REQUIRED",
    });
    expect(physical.calls).toHaveLength(0);
  });

  it("prepare 응답이 모호하면 read로 completed를 복구하되 새 호출은 금지한다", async () => {
    const ledger = new FakeLedger();
    ledger.prepareBehavior = "throw";
    ledger.completedAudit = await baseAudit();
    ledger.getBehavior = "from-last-completed";
    const physical = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "google-gemini", modelId: "gemini-primary" },
    });

    const result = await ledgeredProvider({
      ledger,
      physical,
      recoveryPost: validGeneratedPost(),
    }).generate(request());

    expect(result.post).toEqual(validGeneratedPost());
    expect(ledger.getInputs).toHaveLength(1);
    expect(physical.calls).toHaveLength(0);
  });

  it("finalize가 모호하면 fallback까지 차단해 같은 결과를 중복 생성하지 않는다", async () => {
    const ledger = new FakeLedger();
    ledger.finalizeError = true;
    const primaryPhysical = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "google-gemini", modelId: "gemini-primary" },
    });
    const fallbackPhysical = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "google-gemini", modelId: "gemini-fallback" },
    });
    const provider = new FallbackGeneratedPostProvider([
      ledgeredProvider({ ledger, physical: primaryPhysical }),
      ledgeredProvider({
        ledger,
        physical: fallbackPhysical,
        routeAttempt: 2,
        metadata: {
          providerId: "google-gemini",
          modelId: "gemini-fallback",
        },
      }),
    ]);

    await expect(provider.generate(request())).rejects.toMatchObject({
      code: "MODEL_INVOCATION_RECOVERY_REQUIRED",
    });
    expect(primaryPhysical.calls).toHaveLength(1);
    expect(fallbackPhysical.calls).toHaveLength(0);
  });

  it("finalize 응답만 유실되면 get의 exact completed audit로 성공을 조정한다", async () => {
    const ledger = new FakeLedger();
    ledger.finalizeError = true;
    ledger.getBehavior = "from-last-finalize";
    const physical = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "google-gemini", modelId: "gemini-primary" },
      costEstimator: () => 0.001,
    });

    const result = await ledgeredProvider({ ledger, physical }).generate(
      request(),
    );

    expect(result.post).toEqual(validGeneratedPost());
    expect(physical.calls).toHaveLength(1);
    expect(ledger.getInputs).toHaveLength(1);
  });

  it("예약 output 상한이 실제 요청보다 작으면 장부와 물리 호출 전에 거부한다", async () => {
    const ledger = new FakeLedger();
    const physical = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "google-gemini", modelId: "gemini-primary" },
    });

    await expect(
      ledgeredProvider({
        ledger,
        physical,
        reservation: { inputTokens: 2_000, outputTokens: 1_199, costUsd: 0.01 },
      }).generate(request()),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_CONFIGURATION" });
    expect(ledger.prepareInputs).toHaveLength(0);
    expect(physical.calls).toHaveLength(0);
  });

  it("fingerprint는 abort/timeout과 무관하고 실제 생성 입력에는 민감하다", () => {
    const common = {
      runId: authority.runId,
      scoreOutputReference: "artifact/score/topic-1",
      routeAttempt: 1 as const,
      metadata: { providerId: "google-gemini", modelId: "gemini-primary" },
      promptVersion: GENERATED_POST_PROMPT_VERSION,
    };
    const first = request();
    const operationallyDifferent = {
      ...request(),
      timeoutMs: 99_000,
    };
    const contentDifferent = {
      ...request(),
      maxOutputTokens: 1_201,
    };

    expect(
      createGenerationRequestFingerprint({ ...common, request: first }),
    ).toBe(
      createGenerationRequestFingerprint({
        ...common,
        request: operationallyDifferent,
      }),
    );
    expect(
      createGenerationRequestFingerprint({ ...common, request: first }),
    ).not.toBe(
      createGenerationRequestFingerprint({
        ...common,
        request: contentDifferent,
      }),
    );
  });
});

const semanticRequest = () => ({
  attemptNumber: 1 as const,
  post: validGeneratedPost(),
  evidenceItems: validEvidenceItems().map(
    ({
      evidenceId,
      publisherGroupId,
      provenanceGroupKey,
      sourceRole,
      sourceType,
      authority: evidenceAuthority,
      publishedAt,
      publishedAtPrecision,
      sourceName,
      title,
      passage,
      locator,
    }) => ({
      evidenceId,
      publisherGroupId,
      provenanceGroupKey,
      sourceRole,
      sourceType,
      authority: evidenceAuthority,
      publishedAt,
      publishedAtPrecision,
      sourceName,
      title,
      passage,
      locator,
    }),
  ),
  timeoutMs: 1_000,
  maxOutputTokens: 500,
  maxPhysicalCalls: 2,
});

const semanticReview = {
  passed: true,
  evaluatorVersion: "semantic-evaluator-v1",
  findings: [],
};

async function semanticAudit(metadata = {
  providerId: "google-gemini",
  modelId: "gemini-semantic-primary",
}): Promise<ModelCallAudit> {
  return {
    ...(await baseAudit(metadata)),
    purpose: "semantic_review",
    promptVersion: SEMANTIC_EVALUATOR_PROMPT_VERSION,
    estimatedCostUsd: 0.001,
  };
}

function ledgeredSemantic(input: {
  ledger: FakeLedger;
  evaluator: PostGenerationSemanticEvaluator;
  routeAttempt?: 1 | 2;
  modelId?: string;
  recoveryReview?: unknown;
}) {
  return new LedgeredSemanticEvaluator({
    evaluator: input.evaluator,
    ledger: input.ledger,
    authority,
    providerId: "google-gemini",
    modelId: input.modelId ?? "gemini-semantic-primary",
    routeAttempt: input.routeAttempt ?? 1,
    scoreOutputReference: "artifact/score/topic-1",
    reservation: { inputTokens: 1_000, outputTokens: 500, costUsd: 0.01 },
    recovery:
      input.recoveryReview === undefined
        ? undefined
        : {
            async getCompletedReview() {
              return input.recoveryReview;
            },
          },
  });
}

describe("LedgeredSemanticEvaluator", () => {
  it("route별 prepare → evaluate → finalize 순서와 semantic purpose를 보존한다", async () => {
    const ledger = new FakeLedger();
    const calls: unknown[] = [];
    const audit = await semanticAudit();
    const evaluator: PostGenerationSemanticEvaluator = {
      async evaluate(input) {
        calls.push(input);
        return { review: semanticReview, audit };
      },
    };

    const result = await ledgeredSemantic({ ledger, evaluator }).evaluate(
      semanticRequest(),
    );

    expect(calls).toHaveLength(1);
    expect(ledger.prepareInputs[0]).toMatchObject({
      purpose: "semantic_review",
      routeAttempt: 1,
      promptVersion: SEMANTIC_EVALUATOR_PROMPT_VERSION,
      reservedOutputTokens: 500,
    });
    expect(ledger.finalizeInputs[0]).toMatchObject({
      purpose: "semantic_review",
      routeAttempt: 1,
      audit: { purpose: "semantic_review", routeAttempt: 1 },
    });
    expect(result.review).toEqual(semanticReview);
  });

  it("semantic fallback도 실패 route를 finalize한 뒤 다음 route를 별도 예약한다", async () => {
    const ledger = new FakeLedger();
    const rejected = {
      ...(await semanticAudit()),
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      finishReason: "provider_rate_limited",
    };
    const fallbackAudit = await semanticAudit({
      providerId: "google-gemini",
      modelId: "gemini-semantic-fallback",
    });
    const primary = ledgeredSemantic({
      ledger,
      evaluator: {
        async evaluate() {
          throw new GenerationProviderError("PROVIDER_RATE_LIMITED", {
            audit: rejected,
          });
        },
      },
    });
    const fallback = ledgeredSemantic({
      ledger,
      routeAttempt: 2,
      modelId: "gemini-semantic-fallback",
      evaluator: {
        async evaluate() {
          return { review: semanticReview, audit: fallbackAudit };
        },
      },
    });

    const result = await new FallbackSemanticEvaluator([
      primary,
      fallback,
    ]).evaluate(semanticRequest());

    expect(ledger.prepareInputs.map((input) => input.routeAttempt)).toEqual([
      1, 2,
    ]);
    expect(ledger.finalizeInputs.map((input) => input.routeAttempt)).toEqual([
      1, 2,
    ]);
    expect(result.audits?.map((entry) => entry.routeAttempt)).toEqual([1, 2]);
  });

  it("reserved는 평가를 호출하지 않고 completed는 저장 review만 복구한다", async () => {
    const ledger = new FakeLedger();
    ledger.prepareBehavior = "reserved";
    const calls: number[] = [];
    const evaluator: PostGenerationSemanticEvaluator = {
      async evaluate() {
        calls.push(1);
        return { review: semanticReview, audit: await semanticAudit() };
      },
    };
    await expect(
      ledgeredSemantic({ ledger, evaluator }).evaluate(semanticRequest()),
    ).rejects.toMatchObject({ code: "MODEL_INVOCATION_RECOVERY_REQUIRED" });
    expect(calls).toHaveLength(0);

    ledger.prepareBehavior = "completed";
    ledger.completedAudit = await semanticAudit();
    const recovered = await ledgeredSemantic({
      ledger,
      evaluator,
      recoveryReview: semanticReview,
    }).evaluate(semanticRequest());
    expect(recovered.review).toEqual(semanticReview);
    expect(calls).toHaveLength(0);
  });

  it("semantic audit 비용이 null이면 완료 처리하지 않고 fail-closed한다", async () => {
    const ledger = new FakeLedger();
    const audit = { ...(await semanticAudit()), estimatedCostUsd: null };

    await expect(
      ledgeredSemantic({
        ledger,
        evaluator: {
          async evaluate() {
            return { review: semanticReview, audit };
          },
        },
      }).evaluate(semanticRequest()),
    ).rejects.toMatchObject({ code: "MODEL_INVOCATION_RECOVERY_REQUIRED" });
    expect(ledger.finalizeInputs).toHaveLength(0);
  });

  it("semantic finalize 응답 유실도 get completed exact audit로 조정한다", async () => {
    const ledger = new FakeLedger();
    ledger.finalizeError = true;
    ledger.getBehavior = "from-last-finalize";
    const audit = await semanticAudit();

    const result = await ledgeredSemantic({
      ledger,
      evaluator: {
        async evaluate() {
          return { review: semanticReview, audit };
        },
      },
    }).evaluate(semanticRequest());

    expect(result.review).toEqual(semanticReview);
    expect(ledger.getInputs).toHaveLength(1);
  });
});
