import { createHash } from "node:crypto";

import {
  generatedPostSchema,
  identifierSchema,
  modelCallAuditSchema,
  publicationDateKstSchema,
  sha256Schema,
  type GeneratedPost,
  type ModelCallAudit,
  type ModelCallPurpose,
} from "../../contracts";
import { GENERATED_POST_PROMPT_VERSION } from "../../prompts/generated-post-v2";
import { GenerationProviderError } from "./errors";
import {
  validateGenerationRequest,
  validateProviderMetadata,
} from "./generation-support";
import type {
  GeneratedPostGenerationRequest,
  GeneratedPostGenerationResult,
  GeneratedPostProvider,
  GeneratedPostProviderMetadata,
} from "./types";

export interface ModelInvocationAuthority {
  runDate: string;
  runId: string;
  leaseToken: string;
  fence: number;
  expectedRevision: number;
}

export interface ModelInvocationReservation {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface ModelInvocationIdentity {
  runId: string;
  callId: string;
  purpose: ModelCallPurpose;
  attemptNumber: number;
  routeAttempt: number;
  requestFingerprint: string;
}

export type PrepareModelInvocationReceipt =
  | (ModelInvocationIdentity & {
      status: "prepared";
      mayInvoke: true;
      reservedAt: string;
    })
  | (ModelInvocationIdentity & {
      status: "reserved";
      mayInvoke: false;
      reservedAt: string;
    })
  | (ModelInvocationIdentity & {
      status: "completed";
      mayInvoke: false;
      audit: ModelCallAudit;
    });

export type ReadModelInvocationReceipt =
  | (ModelInvocationIdentity & {
      status: "reserved";
      reservedAt: string;
    })
  | (ModelInvocationIdentity & {
      status: "completed";
      reservedAt: string;
      completedAt: string;
      audit: ModelCallAudit;
    })
  | null;

export interface FinalizeModelInvocationReceipt
  extends ModelInvocationIdentity {
  status: "completed";
  created: boolean;
  audit: ModelCallAudit;
}

export interface ModelInvocationLedger {
  prepare(input: {
    runDate: string;
    runId: string;
    leaseToken: string;
    fence: number;
    expectedRevision: number;
    purpose: ModelCallPurpose;
    attemptNumber: number;
    routeAttempt: number;
    callId: string;
    providerId: string;
    modelId: string;
    promptVersion: string;
    evidenceIds: readonly string[];
    requestFingerprint: string;
    scoreOutputReference: string;
    reservedInputTokens: number;
    reservedOutputTokens: number;
    reservedCostUsd: number;
  }): Promise<PrepareModelInvocationReceipt>;
  finalize(input: {
    runDate: string;
    runId: string;
    leaseToken: string;
    fence: number;
    expectedRevision: number;
    purpose: ModelCallPurpose;
    attemptNumber: number;
    routeAttempt: number;
    callId: string;
    requestFingerprint: string;
    audit: ModelCallAudit;
  }): Promise<FinalizeModelInvocationReceipt>;
  get(input: {
    runId: string;
    purpose: ModelCallPurpose;
    attemptNumber: number;
    routeAttempt: number;
  }): Promise<ReadModelInvocationReceipt>;
}

export interface CompletedGenerationRecovery {
  getCompletedPost(input: {
    runId: string;
    purpose: "draft" | "revision";
    attemptNumber: 1 | 2;
    routeAttempt: 1 | 2;
    callId: string;
    requestFingerprint: string;
    audit: ModelCallAudit;
  }): Promise<GeneratedPost | null>;
}

export interface LedgeredGeneratedPostProviderOptions {
  provider: GeneratedPostProvider;
  ledger: ModelInvocationLedger;
  authority: ModelInvocationAuthority;
  metadata: GeneratedPostProviderMetadata;
  routeAttempt: 1 | 2;
  scoreOutputReference: string;
  reservation:
    | ModelInvocationReservation
    | ((
        request: Readonly<GeneratedPostGenerationRequest>,
      ) => ModelInvocationReservation);
  promptVersion?: string;
  createCallId?: (
    request: Readonly<GeneratedPostGenerationRequest>,
  ) => string;
  recovery?: CompletedGenerationRecovery;
}

type InvocationContext = Readonly<{
  authority: ModelInvocationAuthority;
  purpose: "draft" | "revision";
  attemptNumber: 1 | 2;
  routeAttempt: 1 | 2;
  callId: string;
  requestFingerprint: string;
  evidenceIds: readonly string[];
}>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createGenerationRequestFingerprint(input: {
  runId: string;
  scoreOutputReference: string;
  routeAttempt: 1 | 2;
  metadata: GeneratedPostProviderMetadata;
  promptVersion: string;
  request: Readonly<GeneratedPostGenerationRequest>;
}): string {
  return createHash("sha256")
    .update(
      stableJson({
        version: "generated-post-ledger-v2-fulltext",
        runId: input.runId,
        scoreOutputReference: input.scoreOutputReference,
        routeAttempt: input.routeAttempt,
        providerId: input.metadata.providerId,
        modelId: input.metadata.modelId,
        promptVersion: input.promptVersion,
        attemptNumber: input.request.attemptNumber,
        purpose: input.request.purpose,
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
        revisionReasons: input.request.revisionReasons ?? null,
        maxOutputTokens: input.request.maxOutputTokens,
      }),
    )
    .digest("hex");
}

function isValidAuthority(authority: ModelInvocationAuthority): boolean {
  return (
    publicationDateKstSchema.safeParse(authority.runDate).success &&
    identifierSchema.safeParse(authority.runId).success &&
    identifierSchema.safeParse(authority.leaseToken).success &&
    Number.isInteger(authority.fence) &&
    authority.fence >= 1 &&
    Number.isInteger(authority.expectedRevision) &&
    authority.expectedRevision >= 0
  );
}

function isValidReservation(value: ModelInvocationReservation): boolean {
  return (
    Number.isInteger(value.inputTokens) &&
    value.inputTokens >= 0 &&
    Number.isInteger(value.outputTokens) &&
    value.outputTokens >= 1 &&
    Number.isFinite(value.costUsd) &&
    value.costUsd >= 0
  );
}

function matchesIdentity(
  receipt: ModelInvocationIdentity,
  context: InvocationContext,
): boolean {
  return (
    receipt.runId === context.authority.runId &&
    receipt.purpose === context.purpose &&
    receipt.attemptNumber === context.attemptNumber &&
    receipt.routeAttempt === context.routeAttempt &&
    receipt.callId === context.callId &&
    receipt.requestFingerprint === context.requestFingerprint
  );
}

function normalizeAudit(
  unsafeAudit: ModelCallAudit,
  context: InvocationContext,
  metadata: GeneratedPostProviderMetadata,
  promptVersion: string,
  evidenceIds: readonly string[],
): ModelCallAudit | null {
  const parsed = modelCallAuditSchema.safeParse({
    ...unsafeAudit,
    callId: context.callId,
    attemptNumber: context.attemptNumber,
    routeAttempt: context.routeAttempt,
    purpose: context.purpose,
  });
  if (
    !parsed.success ||
    parsed.data.providerId !== metadata.providerId ||
    parsed.data.modelId !== metadata.modelId ||
    parsed.data.promptVersion !== promptVersion ||
    JSON.stringify(parsed.data.evidenceIds) !== JSON.stringify(evidenceIds)
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

export class LedgeredGeneratedPostProvider implements GeneratedPostProvider {
  readonly #provider: GeneratedPostProvider;
  readonly #ledger: ModelInvocationLedger;
  readonly #authority: ModelInvocationAuthority;
  readonly #metadata: GeneratedPostProviderMetadata;
  readonly #routeAttempt: 1 | 2;
  readonly #scoreOutputReference: string;
  readonly #reservation: LedgeredGeneratedPostProviderOptions["reservation"];
  readonly #promptVersion: string;
  readonly #createCallId:
    | NonNullable<LedgeredGeneratedPostProviderOptions["createCallId"]>
    | undefined;
  readonly #recovery: CompletedGenerationRecovery | undefined;

  constructor(options: Readonly<LedgeredGeneratedPostProviderOptions>) {
    if (
      !isValidAuthority(options.authority) ||
      ![1, 2].includes(options.routeAttempt) ||
      typeof options.scoreOutputReference !== "string" ||
      options.scoreOutputReference.trim().length < 1 ||
      options.scoreOutputReference.length > 500 ||
      typeof (options.promptVersion ?? GENERATED_POST_PROMPT_VERSION) !==
        "string" ||
      (options.promptVersion ?? GENERATED_POST_PROMPT_VERSION).trim().length <
        1 ||
      (options.promptVersion ?? GENERATED_POST_PROMPT_VERSION).length > 64
    ) {
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    }
    this.#provider = options.provider;
    this.#ledger = options.ledger;
    this.#authority = { ...options.authority };
    this.#metadata = validateProviderMetadata(options.metadata);
    this.#routeAttempt = options.routeAttempt;
    this.#scoreOutputReference = options.scoreOutputReference;
    this.#reservation = options.reservation;
    this.#promptVersion = options.promptVersion ?? GENERATED_POST_PROMPT_VERSION;
    this.#createCallId = options.createCallId;
    this.#recovery = options.recovery;
  }

  async generate(
    unsafeRequest: Readonly<GeneratedPostGenerationRequest>,
  ): Promise<GeneratedPostGenerationResult> {
    const request = validateGenerationRequest(unsafeRequest);
    const reservation =
      typeof this.#reservation === "function"
        ? this.#reservation(request)
        : this.#reservation;
    if (!isValidReservation(reservation)) {
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    }
    if (reservation.outputTokens < request.maxOutputTokens) {
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    }
    const requestFingerprint = createGenerationRequestFingerprint({
      runId: this.#authority.runId,
      scoreOutputReference: this.#scoreOutputReference,
      routeAttempt: this.#routeAttempt,
      metadata: this.#metadata,
      promptVersion: this.#promptVersion,
      request,
    });
    const unsafeCallId = this.#createCallId
      ? this.#createCallId(request)
      : `generation-${requestFingerprint.slice(0, 32)}`;
    if (!identifierSchema.safeParse(unsafeCallId).success) {
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    }
    if (!sha256Schema.safeParse(requestFingerprint).success) {
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    }
    const context: InvocationContext = {
      authority: this.#authority,
      purpose: request.purpose,
      attemptNumber: request.attemptNumber,
      routeAttempt: this.#routeAttempt,
      callId: unsafeCallId,
      requestFingerprint,
      evidenceIds: request.evidenceItems.map((item) => item.evidenceId),
    };
    const prepareInput = {
      ...this.#authority,
      purpose: request.purpose,
      attemptNumber: request.attemptNumber,
      routeAttempt: this.#routeAttempt,
      callId: unsafeCallId,
      providerId: this.#metadata.providerId,
      modelId: this.#metadata.modelId,
      promptVersion: this.#promptVersion,
      evidenceIds: request.evidenceItems.map((item) => item.evidenceId),
      requestFingerprint,
      scoreOutputReference: this.#scoreOutputReference,
      reservedInputTokens: reservation.inputTokens,
      reservedOutputTokens: reservation.outputTokens,
      reservedCostUsd: reservation.costUsd,
    } as const;

    let prepared: PrepareModelInvocationReceipt;
    try {
      prepared = await this.#ledger.prepare(prepareInput);
    } catch {
      const recovered = await this.#reconcileAfterPrepareFailure(context);
      if (recovered) return recovered;
      throw recoveryRequired();
    }
    if (!matchesIdentity(prepared, context)) throw recoveryRequired();
    if (prepared.status === "completed") {
      return this.#recoverCompleted(context, prepared.audit);
    }
    if (prepared.status !== "prepared" || !prepared.mayInvoke) {
      throw recoveryRequired();
    }

    try {
      const result = await this.#provider.generate(request);
      const audits = result.audits ?? [result.audit];
      if (audits.length !== 1) throw recoveryRequired();
      const audit = normalizeAudit(
        audits[0],
        context,
        this.#metadata,
        this.#promptVersion,
        prepareInput.evidenceIds,
      );
      if (!audit) throw recoveryRequired();
      const finalized = await this.#finalize(context, audit);
      return { post: result.post, audit: finalized.audit };
    } catch (error) {
      if (!(error instanceof GenerationProviderError)) {
        throw recoveryRequired();
      }
      if (error.code === "MODEL_INVOCATION_RECOVERY_REQUIRED") throw error;
      if (error.audits.length !== 1) throw recoveryRequired();
      const audit = normalizeAudit(
        error.audits[0],
        context,
        this.#metadata,
        this.#promptVersion,
        prepareInput.evidenceIds,
      );
      if (!audit) throw recoveryRequired();
      const finalized = await this.#finalize(context, audit);
      throw new GenerationProviderError(error.code, {
        cause: error,
        audit: finalized.audit,
      });
    }
  }

  async #reconcileAfterPrepareFailure(
    context: InvocationContext,
  ): Promise<GeneratedPostGenerationResult | null> {
    let receipt: ReadModelInvocationReceipt;
    try {
      receipt = await this.#ledger.get({
        runId: context.authority.runId,
        purpose: context.purpose,
        attemptNumber: context.attemptNumber,
        routeAttempt: context.routeAttempt,
      });
    } catch {
      // The original prepare outcome stays authoritative and ambiguous. A read
      // error must never turn into permission for another physical request.
      return null;
    }
    if (!receipt || !matchesIdentity(receipt, context)) return null;
    if (receipt.status === "completed") {
      return this.#recoverCompleted(context, receipt.audit);
    }
    return null;
  }

  async #recoverCompleted(
    context: InvocationContext,
    unsafeAudit: ModelCallAudit,
  ): Promise<GeneratedPostGenerationResult> {
    const audit = normalizeAudit(
      unsafeAudit,
      context,
      this.#metadata,
      this.#promptVersion,
      context.evidenceIds,
    );
    if (!audit || !this.#recovery) throw recoveryRequired(audit ?? undefined);
    const recovered = await this.#recovery.getCompletedPost({
      runId: context.authority.runId,
      purpose: context.purpose,
      attemptNumber: context.attemptNumber,
      routeAttempt: context.routeAttempt,
      callId: context.callId,
      requestFingerprint: context.requestFingerprint,
      audit,
    });
    const post = generatedPostSchema.safeParse(recovered);
    if (!post.success) throw recoveryRequired(audit);
    return { post: post.data, audit };
  }

  async #finalize(
    context: InvocationContext,
    audit: ModelCallAudit,
  ): Promise<FinalizeModelInvocationReceipt> {
    try {
      const finalized = await this.#ledger.finalize({
        ...context.authority,
        purpose: context.purpose,
        attemptNumber: context.attemptNumber,
        routeAttempt: context.routeAttempt,
        callId: context.callId,
        requestFingerprint: context.requestFingerprint,
        audit,
      });
      if (
        finalized.status !== "completed" ||
        !matchesIdentity(finalized, context) ||
        JSON.stringify(finalized.audit) !== JSON.stringify(audit)
      ) {
        throw new Error("ambiguous finalize receipt");
      }
      return finalized;
    } catch {
      try {
        const recovered = await this.#ledger.get({
          runId: context.authority.runId,
          purpose: context.purpose,
          attemptNumber: context.attemptNumber,
          routeAttempt: context.routeAttempt,
        });
        if (
          recovered?.status === "completed" &&
          matchesIdentity(recovered, context) &&
          JSON.stringify(recovered.audit) === JSON.stringify(audit)
        ) {
          return {
            ...identityFromContext(context),
            status: "completed",
            created: false,
            audit,
          };
        }
      } catch {
        // An ambiguous read cannot authorize fallback or a repeated call.
      }
      throw recoveryRequired(audit);
    }
  }
}

function identityFromContext(context: InvocationContext) {
  return {
    runId: context.authority.runId,
    callId: context.callId,
    purpose: context.purpose,
    attemptNumber: context.attemptNumber,
    routeAttempt: context.routeAttempt,
    requestFingerprint: context.requestFingerprint,
  };
}
