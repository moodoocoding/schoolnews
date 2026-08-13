import {
  generationBudgetSchema,
  modelCallAuditSchema,
  type ArticleModelDocument,
  type EvidenceItem,
  type GeneratedPost,
  type GenerationBudget,
  type GenerationUsage,
  type ModelCallAudit,
  type QualityResult,
  type TopicCandidate,
} from "../../contracts";
import {
  GenerationProviderError,
  type GeneratedPostProvider,
  type GenerationProviderErrorCode,
} from "../generation";
import {
  mergeQualityResults,
  runSemanticQualityGate,
  validateGeneratedPost,
} from "../quality";
import { redactSensitiveContactDetails } from "../../prompts/generated-post-v2";
import {
  EMPTY_GENERATION_USAGE,
  canStartModelCall,
  evaluateGenerationBudget,
  recordModelCall,
  recordFailedModelCall,
} from "./generation-budget";

export const POST_GENERATION_PIPELINE_VERSION = "post-generation-v1";

type EvidencePolicy = TopicCandidate["evidencePolicy"];

export type PostGenerationFailureCode =
  | "MODEL_PROVIDER_ERROR"
  | "BUDGET_EXCEEDED"
  | "QUALITY_REJECTED";

export interface RunPostGenerationInput {
  provider: GeneratedPostProvider;
  evidenceItems: readonly EvidenceItem[];
  articleDocuments?: readonly ArticleModelDocument[];
  evidencePolicy: EvidencePolicy;
  budget: GenerationBudget;
  allowAuthoritativeSingleSource?: boolean;
  semanticEvaluator?: PostGenerationSemanticEvaluator;
  abortSignal?: AbortSignal;
}

export interface PostGenerationSemanticEvaluator {
  evaluate(input: {
    attemptNumber: 1 | 2;
    post: GeneratedPost;
    evidenceItems: readonly PostGenerationSemanticEvidence[];
    articleDocuments?: readonly ArticleModelDocument[];
    timeoutMs: number;
    maxOutputTokens: number;
    maxPhysicalCalls?: number;
    abortSignal?: AbortSignal;
  }): Promise<PostGenerationSemanticEvaluationResult>;
}

export type PostGenerationSemanticEvidence = Pick<
  EvidenceItem,
  | "evidenceId"
  | "publisherGroupId"
  | "provenanceGroupKey"
  | "sourceRole"
  | "sourceType"
  | "authority"
  | "publishedAt"
  | "publishedAtPrecision"
> & {
  sourceName: string;
  title: string;
  passage: string;
  locator: string | null;
};

export interface PostGenerationSemanticEvaluationResult {
  review: unknown;
  audit: ModelCallAudit;
  /** Every physical API request, including zero-token fallback rejections. */
  audits?: readonly ModelCallAudit[];
}

export interface PostGenerationAttempt {
  attemptNumber: 1 | 2;
  purpose: ModelCallAudit["purpose"];
  status: "succeeded" | "failed";
  audit: ModelCallAudit | null;
  errorCode: GenerationProviderErrorCode | null;
}

export interface PostGenerationResult {
  status: "validated" | "withheld";
  /** Only a fully validated post is exposed to the next pipeline stage. */
  post: GeneratedPost | null;
  qualityResult: QualityResult | null;
  audits: ModelCallAudit[];
  attempts: PostGenerationAttempt[];
  usage: GenerationUsage;
  failureCode: PostGenerationFailureCode | null;
  providerErrorCode: GenerationProviderErrorCode | null;
  pipelineVersion: typeof POST_GENERATION_PIPELINE_VERSION;
}

const NON_REVISABLE_REASONS = new Set<
  QualityResult["blockingReasons"][number]
>([
  "MISSING_EVIDENCE",
  "INSUFFICIENT_INDEPENDENT_SOURCES",
  "SOURCE_METADATA_INVALID",
  "SOURCE_CONFLICT",
  "BUDGET_EXCEEDED",
]);

function withheld(input: {
  qualityResult: QualityResult | null;
  audits: ModelCallAudit[];
  attempts: PostGenerationAttempt[];
  usage: GenerationUsage;
  failureCode: PostGenerationFailureCode;
  providerErrorCode?: GenerationProviderErrorCode | null;
}): PostGenerationResult {
  return {
    status: "withheld",
    post: null,
    qualityResult: input.qualityResult,
    audits: input.audits,
    attempts: input.attempts,
    usage: input.usage,
    failureCode: input.failureCode,
    providerErrorCode: input.providerErrorCode ?? null,
    pipelineVersion: POST_GENERATION_PIPELINE_VERSION,
  };
}

function providerErrorCode(error: unknown): GenerationProviderErrorCode | null {
  return error instanceof GenerationProviderError ? error.code : null;
}

function fallbackAuditErrorCode(
  audit: ModelCallAudit,
): GenerationProviderErrorCode | null {
  switch (audit.finishReason) {
    case "provider_rate_limited":
      return "PROVIDER_RATE_LIMITED";
    case "provider_model_unavailable":
      return "PROVIDER_MODEL_UNAVAILABLE";
    case "provider_unavailable":
      return "PROVIDER_UNAVAILABLE";
    default:
      return null;
  }
}

function validateAuditForAttempt(
  candidate: unknown,
  attemptNumber: 1 | 2,
  evidenceItems: readonly EvidenceItem[],
  priorAudits: readonly ModelCallAudit[] = [],
): ModelCallAudit {
  const audit = modelCallAuditSchema.parse(candidate);
  const expectedPurpose = attemptNumber === 1 ? "draft" : "revision";
  const expectedEvidenceIds = evidenceItems.map((item) => item.evidenceId).sort();
  const auditEvidenceIds = [...audit.evidenceIds].sort();

  if (
    audit.attemptNumber !== attemptNumber ||
    audit.purpose !== expectedPurpose ||
    JSON.stringify(auditEvidenceIds) !== JSON.stringify(expectedEvidenceIds) ||
    priorAudits.some((prior) => prior.callId === audit.callId) ||
    priorAudits
      .filter((prior) => prior.purpose !== "semantic_review")
      .some(
      (prior) =>
        prior.providerId !== audit.providerId ||
        prior.promptVersion !== audit.promptVersion,
      )
  ) {
    throw new GenerationProviderError("INVALID_MODEL_USAGE");
  }
  return audit;
}

function validateSemanticAudit(
  candidate: unknown,
  attemptNumber: 1 | 2,
  evidenceItems: readonly EvidenceItem[],
  priorAudits: readonly ModelCallAudit[],
): ModelCallAudit {
  const audit = modelCallAuditSchema.parse(candidate);
  const expectedEvidenceIds = evidenceItems.map((item) => item.evidenceId).sort();
  const auditEvidenceIds = [...audit.evidenceIds].sort();
  const priorSemanticAudits = priorAudits.filter(
    (prior) => prior.purpose === "semantic_review",
  );

  if (
    audit.attemptNumber !== attemptNumber ||
    audit.purpose !== "semantic_review" ||
    JSON.stringify(auditEvidenceIds) !== JSON.stringify(expectedEvidenceIds) ||
    priorAudits.some((prior) => prior.callId === audit.callId) ||
    priorSemanticAudits.some(
      (prior) =>
        prior.providerId !== audit.providerId ||
        prior.promptVersion !== audit.promptVersion,
    )
  ) {
    throw new GenerationProviderError("INVALID_MODEL_USAGE");
  }
  return audit;
}

async function validatePost(
  post: GeneratedPost,
  input: RunPostGenerationInput,
  evaluatorReview: unknown,
): Promise<QualityResult> {
  const structural = validateGeneratedPost({
    post,
    evidenceItems: input.evidenceItems,
    evidencePolicy: input.evidencePolicy,
    allowAuthoritativeSingleSource:
      input.allowAuthoritativeSingleSource ?? false,
  });
  const semantic = runSemanticQualityGate({
    post,
    evidenceItems: input.evidenceItems,
    evaluatorReview,
  });
  return mergeQualityResults(structural, semantic.qualityResult);
}

function revisionReasons(result: QualityResult): string[] {
  return Array.from(
    new Set([
      ...result.blockingReasons,
      ...result.checks.flatMap((check) => check.reasons),
    ]),
  )
    .map((reason) => reason.slice(0, 500))
    .slice(0, 20);
}

function semanticEvidenceView(
  items: readonly EvidenceItem[],
): PostGenerationSemanticEvidence[] {
  return items.map((item) => ({
    evidenceId: item.evidenceId,
    publisherGroupId: item.publisherGroupId,
    provenanceGroupKey: item.provenanceGroupKey,
    sourceRole: item.sourceRole,
    sourceType: item.sourceType,
    authority: item.authority,
    sourceName: redactSensitiveContactDetails(item.sourceName),
    title: redactSensitiveContactDetails(item.title),
    publishedAt: item.publishedAt,
    publishedAtPrecision: item.publishedAtPrecision,
    passage: redactSensitiveContactDetails(item.passage),
    locator:
      item.locator === null
        ? null
        : redactSensitiveContactDetails(item.locator),
  }));
}

function isRevisable(result: QualityResult): boolean {
  return (
    result.blockingReasons.length > 0 &&
    result.blockingReasons.every((reason) => !NON_REVISABLE_REASONS.has(reason))
  );
}

/**
 * Generates at most one draft and one revision. A generated draft is never
 * returned unless both deterministic quality gates and all budget checks pass.
 */
export async function runPostGeneration(
  unsafeInput: Readonly<RunPostGenerationInput>,
): Promise<PostGenerationResult> {
  const budget = generationBudgetSchema.parse(unsafeInput.budget);
  const input: RunPostGenerationInput = { ...unsafeInput, budget };
  const audits: ModelCallAudit[] = [];
  const attempts: PostGenerationAttempt[] = [];
  let usage: GenerationUsage = { ...EMPTY_GENERATION_USAGE };
  let lastQuality: QualityResult | null = null;

  for (const attemptNumber of [1, 2] as const) {
    if (!canStartModelCall(usage, budget)) {
      return withheld({
        qualityResult: lastQuality,
        audits,
        attempts,
        usage,
        failureCode: lastQuality ? "QUALITY_REJECTED" : "BUDGET_EXCEEDED",
      });
    }

    const remainingOutputTokens = budget.maxOutputTokens - usage.outputTokens;
    if (remainingOutputTokens < 1) {
      return withheld({
        qualityResult: lastQuality,
        audits,
        attempts,
        usage,
        failureCode: "BUDGET_EXCEEDED",
      });
    }

    let generated: Awaited<ReturnType<GeneratedPostProvider["generate"]>>;
    try {
      generated = await input.provider.generate({
        attemptNumber,
        purpose: attemptNumber === 1 ? "draft" : "revision",
        evidenceItems: input.evidenceItems,
        articleDocuments: input.articleDocuments,
        revisionReasons:
          attemptNumber === 2 && lastQuality
            ? revisionReasons(lastQuality)
            : null,
        timeoutMs: budget.maxCallSeconds * 1_000,
        maxOutputTokens: remainingOutputTokens,
        maxPhysicalCalls: budget.maxModelCalls - usage.modelCalls,
        abortSignal: input.abortSignal,
      });
      const physicalAudits = generated.audits ?? [generated.audit];
      if (
        physicalAudits.length === 0 ||
        physicalAudits.at(-1)?.callId !== generated.audit.callId
      ) {
        throw new GenerationProviderError("INVALID_MODEL_USAGE");
      }
      for (const [physicalIndex, candidate] of physicalAudits.entries()) {
        const audit = validateAuditForAttempt(
          candidate,
          attemptNumber,
          input.evidenceItems,
          audits,
        );
        usage = recordModelCall(usage, audit);
        audits.push(audit);
        attempts.push({
          attemptNumber,
          purpose: attemptNumber === 1 ? "draft" : "revision",
          status:
            physicalIndex === physicalAudits.length - 1
              ? "succeeded"
              : "failed",
          audit,
          errorCode:
            physicalIndex === physicalAudits.length - 1
              ? null
              : fallbackAuditErrorCode(audit),
        });
      }
    } catch (error) {
      let failedAudit: ModelCallAudit | null = null;
      const errorAudits =
        error instanceof GenerationProviderError ? error.audits : [];
      for (const candidate of errorAudits) {
        try {
          failedAudit = validateAuditForAttempt(
            candidate,
            attemptNumber,
            input.evidenceItems,
            audits,
          );
          usage = recordFailedModelCall(usage, failedAudit);
          audits.push(failedAudit);
        } catch {
          failedAudit = null;
          usage = recordFailedModelCall(usage, null);
        }
      }
      if (errorAudits.length === 0) usage = recordFailedModelCall(usage, null);
      attempts.push({
        attemptNumber,
        purpose: attemptNumber === 1 ? "draft" : "revision",
        status: "failed",
        audit: failedAudit,
        errorCode: providerErrorCode(error),
      });
      return withheld({
        qualityResult: lastQuality,
        audits,
        attempts,
        usage,
        failureCode: "MODEL_PROVIDER_ERROR",
        providerErrorCode: providerErrorCode(error),
      });
    }

    const budgetResult = evaluateGenerationBudget(usage, budget);
    if (!budgetResult.passed) {
      return withheld({
        qualityResult: lastQuality,
        audits,
        attempts,
        usage,
        failureCode: "BUDGET_EXCEEDED",
      });
    }

    let evaluatorReview: unknown = {
      passed: false,
      evaluatorVersion: "semantic-evaluator-missing-v1",
      findings: [
        {
          code: "SOURCE_CONFLICT",
          message:
            "근거와 문장의 의미 일치를 확인할 외부 평가기가 연결되지 않았습니다.",
          claimIds: [],
          evidenceIds: [],
        },
      ],
    };

    if (input.semanticEvaluator) {
      if (!canStartModelCall(usage, budget)) {
        return withheld({
          qualityResult: lastQuality,
          audits,
          attempts,
          usage,
          failureCode: "BUDGET_EXCEEDED",
        });
      }
      const evaluatorOutputTokens = budget.maxOutputTokens - usage.outputTokens;
      if (evaluatorOutputTokens < 1) {
        return withheld({
          qualityResult: lastQuality,
          audits,
          attempts,
          usage,
          failureCode: "BUDGET_EXCEEDED",
        });
      }
      try {
        const evaluated = await input.semanticEvaluator.evaluate({
          attemptNumber,
          post: generated.post,
          evidenceItems: semanticEvidenceView(input.evidenceItems),
          articleDocuments: input.articleDocuments,
          timeoutMs: budget.maxCallSeconds * 1_000,
          maxOutputTokens: evaluatorOutputTokens,
          maxPhysicalCalls: budget.maxModelCalls - usage.modelCalls,
          abortSignal: input.abortSignal,
        });
        const physicalAudits = evaluated.audits ?? [evaluated.audit];
        if (
          physicalAudits.length === 0 ||
          physicalAudits.at(-1)?.callId !== evaluated.audit.callId
        ) {
          throw new GenerationProviderError("INVALID_MODEL_USAGE");
        }
        for (const [physicalIndex, candidate] of physicalAudits.entries()) {
          const audit = validateSemanticAudit(
            candidate,
            attemptNumber,
            input.evidenceItems,
            audits,
          );
          usage = recordModelCall(usage, audit);
          audits.push(audit);
          attempts.push({
            attemptNumber,
            purpose: "semantic_review",
            status:
              physicalIndex === physicalAudits.length - 1
                ? "succeeded"
                : "failed",
            audit,
            errorCode:
              physicalIndex === physicalAudits.length - 1
                ? null
                : fallbackAuditErrorCode(audit),
          });
        }
        evaluatorReview = evaluated.review;
      } catch (error) {
        let failedAudit: ModelCallAudit | null = null;
        const errorAudits =
          error instanceof GenerationProviderError ? error.audits : [];
        for (const candidate of errorAudits) {
          try {
            failedAudit = validateSemanticAudit(
              candidate,
              attemptNumber,
              input.evidenceItems,
              audits,
            );
            usage = recordFailedModelCall(usage, failedAudit);
            audits.push(failedAudit);
          } catch {
            failedAudit = null;
            usage = recordFailedModelCall(usage, null);
          }
        }
        if (errorAudits.length === 0)
          usage = recordFailedModelCall(usage, null);
        attempts.push({
          attemptNumber,
          purpose: "semantic_review",
          status: "failed",
          audit: failedAudit,
          errorCode: providerErrorCode(error),
        });
        return withheld({
          qualityResult: lastQuality,
          audits,
          attempts,
          usage,
          failureCode: "MODEL_PROVIDER_ERROR",
          providerErrorCode: providerErrorCode(error),
        });
      }

      const evaluationBudgetResult = evaluateGenerationBudget(usage, budget);
      if (!evaluationBudgetResult.passed) {
        return withheld({
          qualityResult: lastQuality,
          audits,
          attempts,
          usage,
          failureCode: "BUDGET_EXCEEDED",
        });
      }
    }

    lastQuality = await validatePost(generated.post, input, evaluatorReview);
    if (lastQuality.passed) {
      return {
        status: "validated",
        post: generated.post,
        qualityResult: lastQuality,
        audits,
        attempts,
        usage,
        failureCode: null,
        providerErrorCode: null,
        pipelineVersion: POST_GENERATION_PIPELINE_VERSION,
      };
    }

    if (attemptNumber === 2 || !isRevisable(lastQuality)) {
      return withheld({
        qualityResult: lastQuality,
        audits,
        attempts,
        usage,
        failureCode: "QUALITY_REJECTED",
      });
    }
  }

  return withheld({
    qualityResult: lastQuality,
    audits,
    attempts,
    usage,
    failureCode: "QUALITY_REJECTED",
  });
}
