import {
  evidenceItemSchema,
  generatedPostSchema,
  generationPurposeSchema,
  identifierSchema,
  modelCallAuditSchema,
  modelUsageSchema,
  type EvidenceItem,
  type GeneratedPost,
  type ModelCallAudit,
  type ModelUsage,
} from "../../contracts";
import { GENERATED_POST_PROMPT_VERSION } from "../../prompts/generated-post-v2";
import { assertEvidenceSafeForModel } from "../../prompts/prompt-data-safety";
import { GenerationProviderError } from "./errors";
import type {
  GeneratedPostGenerationRequest,
  GeneratedPostProviderMetadata,
  ModelCostEstimator,
} from "./types";

const modelIdMaxLength = 160;

export function validateProviderMetadata(
  metadata: Readonly<GeneratedPostProviderMetadata>,
): GeneratedPostProviderMetadata {
  const providerId = identifierSchema.safeParse(metadata.providerId);
  const modelId = metadata.modelId?.trim();
  if (
    !providerId.success ||
    typeof modelId !== "string" ||
    modelId.length === 0 ||
    modelId.length > modelIdMaxLength
  ) {
    throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
  }
  return { providerId: providerId.data, modelId };
}

export function validateGenerationRequest(
  request: Readonly<GeneratedPostGenerationRequest>,
): GeneratedPostGenerationRequest {
  const purpose = generationPurposeSchema.safeParse(request.purpose);
  const expectedAttempt = request.purpose === "draft" ? 1 : 2;
  const validLimits =
    Number.isInteger(request.timeoutMs) &&
    request.timeoutMs >= 1 &&
    request.timeoutMs <= 300_000 &&
    Number.isInteger(request.maxOutputTokens) &&
    request.maxOutputTokens >= 1 &&
    (request.maxPhysicalCalls === undefined ||
      (Number.isInteger(request.maxPhysicalCalls) &&
        request.maxPhysicalCalls >= 1 &&
        request.maxPhysicalCalls <= 4));
  const evidenceItems: EvidenceItem[] = [];

  for (const item of request.evidenceItems ?? []) {
    const parsed = evidenceItemSchema.safeParse(item);
    if (!parsed.success) {
      throw new GenerationProviderError("INVALID_GENERATION_INPUT");
    }
    evidenceItems.push(parsed.data);
  }

  const evidenceIds = evidenceItems.map((item) => item.evidenceId);
  const hasDuplicateEvidenceId =
    new Set(evidenceIds).size !== evidenceIds.length;
  const revisionReasons = Array.isArray(request.revisionReasons)
    ? request.revisionReasons.map((reason) =>
        typeof reason === "string" ? reason.trim() : "",
      )
    : request.revisionReasons;
  const validRevisionReasons =
    request.purpose === "revision"
      ? Array.isArray(revisionReasons) &&
        revisionReasons.length >= 1 &&
        revisionReasons.length <= 20 &&
        revisionReasons.every(
          (reason) => reason.length >= 1 && reason.length <= 500,
        )
      : request.revisionReasons == null;

  if (
    !purpose.success ||
    request.attemptNumber !== expectedAttempt ||
    !validLimits ||
    evidenceItems.length === 0 ||
    hasDuplicateEvidenceId ||
    !validRevisionReasons
  ) {
    throw new GenerationProviderError("INVALID_GENERATION_INPUT");
  }

  try {
    assertEvidenceSafeForModel(evidenceItems);
  } catch (error) {
    throw new GenerationProviderError("INVALID_GENERATION_INPUT", {
      cause: error,
    });
  }

  if (request.abortSignal?.aborted) {
    throw new GenerationProviderError("PROVIDER_ABORTED");
  }

  return {
    attemptNumber: request.attemptNumber,
    purpose: purpose.data,
    evidenceItems,
    revisionReasons: revisionReasons ?? null,
    timeoutMs: request.timeoutMs,
    maxOutputTokens: request.maxOutputTokens,
    maxPhysicalCalls: request.maxPhysicalCalls ?? 1,
    abortSignal: request.abortSignal,
  };
}

export function parseGeneratedPost(output: unknown): GeneratedPost {
  const parsed = generatedPostSchema.safeParse(output);
  if (!parsed.success) {
    throw new GenerationProviderError("INVALID_MODEL_OUTPUT");
  }
  return parsed.data;
}

export function parseModelUsage(input: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}): ModelUsage {
  const inputTokens = input.inputTokens;
  const outputTokens = input.outputTokens;
  if (inputTokens == null || outputTokens == null) {
    throw new GenerationProviderError("INVALID_MODEL_USAGE");
  }
  const totalTokens = input.totalTokens ?? inputTokens + outputTokens;
  const parsed = modelUsageSchema.safeParse({
    inputTokens,
    outputTokens,
    totalTokens,
  });
  if (!parsed.success) {
    throw new GenerationProviderError("INVALID_MODEL_USAGE");
  }
  return parsed.data;
}

export function estimateModelCost(
  estimator: ModelCostEstimator | undefined,
  usage: ModelUsage,
  metadata: GeneratedPostProviderMetadata,
): number | null {
  if (!estimator) {
    return null;
  }
  let estimatedCostUsd: number;
  try {
    estimatedCostUsd = estimator(usage, metadata);
  } catch (error) {
    throw new GenerationProviderError("INVALID_COST_ESTIMATE", {
      cause: error,
    });
  }
  if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) {
    throw new GenerationProviderError("INVALID_COST_ESTIMATE");
  }
  return estimatedCostUsd;
}

export function createModelCallAudit(input: {
  callId: string;
  request: GeneratedPostGenerationRequest;
  metadata: GeneratedPostProviderMetadata;
  startedAt: Date;
  finishedAt: Date;
  usage: ModelUsage;
  estimatedCostUsd: number | null;
  finishReason: string | null;
  responseId: string | null;
}): ModelCallAudit {
  const parsed = modelCallAuditSchema.safeParse({
    callId: input.callId,
    attemptNumber: input.request.attemptNumber,
    purpose: input.request.purpose,
    providerId: input.metadata.providerId,
    modelId: input.metadata.modelId,
    promptVersion: GENERATED_POST_PROMPT_VERSION,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    evidenceIds: input.request.evidenceItems.map((item) => item.evidenceId),
    usage: input.usage,
    estimatedCostUsd: input.estimatedCostUsd,
    finishReason: input.finishReason,
    responseId: input.responseId,
  });
  if (!parsed.success) {
    throw new GenerationProviderError("INVALID_MODEL_USAGE");
  }
  return parsed.data;
}
