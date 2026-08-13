import { createHash } from "node:crypto";

import { z } from "zod";

import {
  evidenceAuthoritySchema,
  evidenceSourceRoleSchema,
  evidenceSourceTypeSchema,
  generatedPostSchema,
  identifierSchema,
  isoTimestampSchema,
  modelCallAuditSchema,
  publicationDateKstSchema,
  publicationTimePrecisionSchema,
  semanticReviewSchema,
  type ModelCallAudit,
} from "../../contracts";
import {
  GenerationProviderError,
  type ModelInvocationAuthority,
  type ModelInvocationLedger,
  type ModelInvocationReservation,
} from "../generation";
import { SEMANTIC_EVALUATOR_PROMPT_VERSION } from "./ai-sdk-semantic-evaluator";
import type {
  PostGenerationSemanticEvaluationResult,
  PostGenerationSemanticEvaluator,
} from "./run-post-generation";

type SemanticRequest = Parameters<PostGenerationSemanticEvaluator["evaluate"]>[0];

const semanticEvidenceSchema = z
  .object({
    evidenceId: identifierSchema,
    publisherGroupId: identifierSchema,
    provenanceGroupKey: identifierSchema,
    sourceRole: evidenceSourceRoleSchema,
    sourceType: evidenceSourceTypeSchema,
    authority: evidenceAuthoritySchema,
    publishedAt: isoTimestampSchema,
    publishedAtPrecision: publicationTimePrecisionSchema,
    sourceName: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    passage: z.string().trim().min(1).max(2_000),
    locator: z.string().trim().max(300).nullable(),
  })
  .strict();

export interface CompletedSemanticReviewRecovery {
  getCompletedReview(input: {
    runId: string;
    attemptNumber: 1 | 2;
    routeAttempt: 1 | 2;
    callId: string;
    requestFingerprint: string;
    audit: ModelCallAudit;
  }): Promise<unknown | null>;
}

export interface LedgeredSemanticEvaluatorOptions {
  evaluator: PostGenerationSemanticEvaluator;
  ledger: ModelInvocationLedger;
  authority: ModelInvocationAuthority;
  providerId: string;
  modelId: string;
  routeAttempt: 1 | 2;
  scoreOutputReference: string;
  reservation:
    | ModelInvocationReservation
    | ((request: Readonly<SemanticRequest>) => ModelInvocationReservation);
  promptVersion?: string;
  createCallId?: (request: Readonly<SemanticRequest>) => string;
  recovery?: CompletedSemanticReviewRecovery;
}

type Context = Readonly<{
  authority: ModelInvocationAuthority;
  attemptNumber: 1 | 2;
  routeAttempt: 1 | 2;
  callId: string;
  requestFingerprint: string;
  evidenceIds: readonly string[];
}>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createSemanticReviewRequestFingerprint(input: {
  runId: string;
  scoreOutputReference: string;
  routeAttempt: 1 | 2;
  providerId: string;
  modelId: string;
  promptVersion: string;
  request: Readonly<SemanticRequest>;
}): string {
  return createHash("sha256")
    .update(
      stableJson({
        version: "semantic-review-ledger-v2-fulltext",
        runId: input.runId,
        scoreOutputReference: input.scoreOutputReference,
        routeAttempt: input.routeAttempt,
        providerId: input.providerId,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        attemptNumber: input.request.attemptNumber,
        post: input.request.post,
        evidenceItems: input.request.evidenceItems,
        articleDocuments: input.request.articleDocuments?.map((document) => ({
          documentId: document.documentId,
          articleId: document.articleId,
          evidenceId: document.evidenceId,
          contentHash: document.contentHash,
          retentionExpiresAt: document.retentionExpiresAt,
          rightsBasisUrl: document.rightsBasisUrl,
          termsReviewedAt: document.termsReviewedAt,
        })),
        maxOutputTokens: input.request.maxOutputTokens,
      }),
    )
    .digest("hex");
}

function validReservation(
  reservation: ModelInvocationReservation,
  maxOutputTokens: number,
): boolean {
  return (
    Number.isInteger(reservation.inputTokens) &&
    reservation.inputTokens >= 0 &&
    Number.isInteger(reservation.outputTokens) &&
    reservation.outputTokens >= maxOutputTokens &&
    Number.isFinite(reservation.costUsd) &&
    reservation.costUsd >= 0
  );
}

function matchesIdentity(
  receipt: {
    runId: string;
    callId: string;
    purpose: string;
    attemptNumber: number;
    routeAttempt: number;
    requestFingerprint: string;
  },
  context: Context,
): boolean {
  return (
    receipt.runId === context.authority.runId &&
    receipt.callId === context.callId &&
    receipt.purpose === "semantic_review" &&
    receipt.attemptNumber === context.attemptNumber &&
    receipt.routeAttempt === context.routeAttempt &&
    receipt.requestFingerprint === context.requestFingerprint
  );
}

function normalizeAudit(
  unsafeAudit: ModelCallAudit,
  context: Context,
  options: Readonly<{
    providerId: string;
    modelId: string;
    promptVersion: string;
  }>,
): ModelCallAudit | null {
  const parsed = modelCallAuditSchema.safeParse({
    ...unsafeAudit,
    callId: context.callId,
    purpose: "semantic_review",
    attemptNumber: context.attemptNumber,
    routeAttempt: context.routeAttempt,
  });
  if (
    !parsed.success ||
    parsed.data.providerId !== options.providerId ||
    parsed.data.modelId !== options.modelId ||
    parsed.data.promptVersion !== options.promptVersion ||
    parsed.data.estimatedCostUsd === null ||
    JSON.stringify(parsed.data.evidenceIds) !==
      JSON.stringify(context.evidenceIds)
  ) {
    return null;
  }
  return parsed.data;
}

function recoveryRequired(audit?: ModelCallAudit): GenerationProviderError {
  return new GenerationProviderError("MODEL_INVOCATION_RECOVERY_REQUIRED", {
    audit: audit ?? null,
  });
}

export class LedgeredSemanticEvaluator
  implements PostGenerationSemanticEvaluator
{
  readonly #options: Readonly<LedgeredSemanticEvaluatorOptions>;
  readonly #promptVersion: string;

  constructor(options: Readonly<LedgeredSemanticEvaluatorOptions>) {
    const validAuthority =
      publicationDateKstSchema.safeParse(options.authority.runDate).success &&
      identifierSchema.safeParse(options.authority.runId).success &&
      identifierSchema.safeParse(options.authority.leaseToken).success &&
      Number.isInteger(options.authority.fence) &&
      options.authority.fence >= 1 &&
      Number.isInteger(options.authority.expectedRevision) &&
      options.authority.expectedRevision >= 0;
    const promptVersion =
      options.promptVersion ?? SEMANTIC_EVALUATOR_PROMPT_VERSION;
    if (
      !validAuthority ||
      !identifierSchema.safeParse(options.providerId).success ||
      typeof options.modelId !== "string" ||
      options.modelId.trim().length < 1 ||
      options.modelId.length > 160 ||
      ![1, 2].includes(options.routeAttempt) ||
      typeof options.scoreOutputReference !== "string" ||
      options.scoreOutputReference.trim().length < 1 ||
      options.scoreOutputReference.length > 500 ||
      promptVersion.trim().length < 1 ||
      promptVersion.length > 64
    ) {
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    }
    this.#options = options;
    this.#promptVersion = promptVersion;
  }

  async evaluate(
    unsafeRequest: SemanticRequest,
  ): Promise<PostGenerationSemanticEvaluationResult> {
    const post = generatedPostSchema.safeParse(unsafeRequest.post);
    const evidenceItems = z
      .array(semanticEvidenceSchema)
      .min(1)
      .safeParse(unsafeRequest.evidenceItems);
    const validLimits =
      [1, 2].includes(unsafeRequest.attemptNumber) &&
      Number.isInteger(unsafeRequest.timeoutMs) &&
      unsafeRequest.timeoutMs >= 1 &&
      unsafeRequest.timeoutMs <= 300_000 &&
      Number.isInteger(unsafeRequest.maxOutputTokens) &&
      unsafeRequest.maxOutputTokens >= 1;
    if (
      !post.success ||
      !evidenceItems.success ||
      new Set(evidenceItems.success ? evidenceItems.data.map((item) => item.evidenceId) : [])
        .size !== (evidenceItems.success ? evidenceItems.data.length : 0) ||
      !validLimits ||
      unsafeRequest.abortSignal?.aborted
    ) {
      throw new GenerationProviderError("INVALID_GENERATION_INPUT");
    }
    const request: SemanticRequest = {
      ...unsafeRequest,
      post: post.data,
      evidenceItems: evidenceItems.data,
    };
    const reservation =
      typeof this.#options.reservation === "function"
        ? this.#options.reservation(request)
        : this.#options.reservation;
    if (!validReservation(reservation, request.maxOutputTokens)) {
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    }
    const requestFingerprint = createSemanticReviewRequestFingerprint({
      runId: this.#options.authority.runId,
      scoreOutputReference: this.#options.scoreOutputReference,
      routeAttempt: this.#options.routeAttempt,
      providerId: this.#options.providerId,
      modelId: this.#options.modelId,
      promptVersion: this.#promptVersion,
      request,
    });
    const callId = this.#options.createCallId
      ? this.#options.createCallId(request)
      : `semantic-${requestFingerprint.slice(0, 32)}`;
    if (!identifierSchema.safeParse(callId).success) {
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    }
    const evidenceIds = request.evidenceItems.map((item) => item.evidenceId);
    const context: Context = {
      authority: this.#options.authority,
      attemptNumber: request.attemptNumber,
      routeAttempt: this.#options.routeAttempt,
      callId,
      requestFingerprint,
      evidenceIds,
    };
    const prepareInput = {
      ...this.#options.authority,
      purpose: "semantic_review" as const,
      attemptNumber: request.attemptNumber,
      routeAttempt: this.#options.routeAttempt,
      callId,
      providerId: this.#options.providerId,
      modelId: this.#options.modelId,
      promptVersion: this.#promptVersion,
      evidenceIds,
      requestFingerprint,
      scoreOutputReference: this.#options.scoreOutputReference,
      reservedInputTokens: reservation.inputTokens,
      reservedOutputTokens: reservation.outputTokens,
      reservedCostUsd: reservation.costUsd,
    };

    let prepared: Awaited<ReturnType<ModelInvocationLedger["prepare"]>>;
    try {
      prepared = await this.#options.ledger.prepare(prepareInput);
    } catch {
      const recovered = await this.#readCompleted(context);
      if (recovered) return recovered;
      throw recoveryRequired();
    }
    if (!matchesIdentity(prepared, context)) throw recoveryRequired();
    if (prepared.status === "completed") {
      return this.#recover(context, prepared.audit);
    }
    if (prepared.status !== "prepared" || !prepared.mayInvoke) {
      throw recoveryRequired();
    }

    try {
      const result = await this.#options.evaluator.evaluate(request);
      const audits = result.audits ?? [result.audit];
      if (audits.length !== 1) throw recoveryRequired();
      const audit = normalizeAudit(audits[0], context, {
        providerId: this.#options.providerId,
        modelId: this.#options.modelId,
        promptVersion: this.#promptVersion,
      });
      const review = semanticReviewSchema.safeParse(result.review);
      if (!audit || !review.success) throw recoveryRequired(audit ?? undefined);
      const finalized = await this.#finalize(context, audit);
      return { review: review.data, audit: finalized };
    } catch (error) {
      if (!(error instanceof GenerationProviderError)) {
        throw recoveryRequired();
      }
      if (error.code === "MODEL_INVOCATION_RECOVERY_REQUIRED") throw error;
      if (error.audits.length !== 1) throw recoveryRequired();
      const audit = normalizeAudit(error.audits[0], context, {
        providerId: this.#options.providerId,
        modelId: this.#options.modelId,
        promptVersion: this.#promptVersion,
      });
      if (!audit) throw recoveryRequired();
      const finalized = await this.#finalize(context, audit);
      throw new GenerationProviderError(error.code, {
        cause: error,
        audit: finalized,
      });
    }
  }

  async #readCompleted(
    context: Context,
  ): Promise<PostGenerationSemanticEvaluationResult | null> {
    try {
      const receipt = await this.#options.ledger.get({
        runId: context.authority.runId,
        purpose: "semantic_review",
        attemptNumber: context.attemptNumber,
        routeAttempt: context.routeAttempt,
      });
      if (
        receipt?.status === "completed" &&
        matchesIdentity(receipt, context)
      ) {
        return this.#recover(context, receipt.audit);
      }
    } catch {
      return null;
    }
    return null;
  }

  async #recover(
    context: Context,
    unsafeAudit: ModelCallAudit,
  ): Promise<PostGenerationSemanticEvaluationResult> {
    const audit = normalizeAudit(unsafeAudit, context, {
      providerId: this.#options.providerId,
      modelId: this.#options.modelId,
      promptVersion: this.#promptVersion,
    });
    if (!audit || !this.#options.recovery) {
      throw recoveryRequired(audit ?? undefined);
    }
    const recovered = await this.#options.recovery.getCompletedReview({
      runId: context.authority.runId,
      attemptNumber: context.attemptNumber,
      routeAttempt: context.routeAttempt,
      callId: context.callId,
      requestFingerprint: context.requestFingerprint,
      audit,
    });
    const review = semanticReviewSchema.safeParse(recovered);
    if (!review.success) throw recoveryRequired(audit);
    return { review: review.data, audit };
  }

  async #finalize(context: Context, audit: ModelCallAudit) {
    try {
      const receipt = await this.#options.ledger.finalize({
        ...context.authority,
        purpose: "semantic_review",
        attemptNumber: context.attemptNumber,
        routeAttempt: context.routeAttempt,
        callId: context.callId,
        requestFingerprint: context.requestFingerprint,
        audit,
      });
      if (
        receipt.status !== "completed" ||
        !matchesIdentity(receipt, context) ||
        JSON.stringify(receipt.audit) !== JSON.stringify(audit)
      ) {
        throw new Error("ambiguous finalize receipt");
      }
      return receipt.audit;
    } catch {
      try {
        const recovered = await this.#options.ledger.get({
          runId: context.authority.runId,
          purpose: "semantic_review",
          attemptNumber: context.attemptNumber,
          routeAttempt: context.routeAttempt,
        });
        if (
          recovered?.status === "completed" &&
          matchesIdentity(recovered, context) &&
          JSON.stringify(recovered.audit) === JSON.stringify(audit)
        ) {
          return audit;
        }
      } catch {
        // An ambiguous read must not authorize another semantic model call.
      }
      throw recoveryRequired(audit);
    }
  }
}
