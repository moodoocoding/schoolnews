import { z } from "zod";

import {
  identifierSchema,
  isoTimestampSchema,
  modelCallAuditSchema,
  modelCallPurposeSchema,
  publicationDateKstSchema,
  sha256Schema,
  type ModelCallAudit,
  type ModelCallPurpose,
} from "../contracts";

export const SUPABASE_MODEL_INVOCATION_RPC_NAMES = [
  "prepare_model_invocation",
  "finalize_model_invocation",
  "get_model_invocation",
] as const;

export type SupabaseModelInvocationRpcName =
  (typeof SUPABASE_MODEL_INVOCATION_RPC_NAMES)[number];

export type SupabaseModelInvocationRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

export type SupabaseModelInvocationRpcResult = Readonly<{
  data: unknown;
  error: SupabaseModelInvocationRpcError | null;
}>;

export interface SupabaseModelInvocationRpcDataSource {
  rpc(
    functionName: SupabaseModelInvocationRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseModelInvocationRpcResult>;
}

const authoritySchema = z
  .object({
    runDate: publicationDateKstSchema,
    runId: identifierSchema,
    leaseToken: identifierSchema,
    fence: z.number().int().min(1),
    expectedRevision: z.number().int().min(0),
  })
  .strict();

const routeAttemptSchema = z.number().int().min(1).max(2);
const intentIdentitySchema = z
  .object({
    purpose: modelCallPurposeSchema,
    attemptNumber: z.number().int().min(1).max(2),
    routeAttempt: routeAttemptSchema,
    callId: identifierSchema,
    requestFingerprint: sha256Schema,
  })
  .strict();

const prepareInputSchema = authoritySchema
  .extend({
    purpose: modelCallPurposeSchema,
    attemptNumber: z.number().int().min(1).max(2),
    routeAttempt: routeAttemptSchema,
    callId: identifierSchema,
    providerId: identifierSchema,
    modelId: z.string().trim().min(1).max(160),
    promptVersion: z.string().trim().min(1).max(64),
    evidenceIds: z.array(identifierSchema).min(1),
    requestFingerprint: sha256Schema,
    scoreOutputReference: z.string().trim().min(1).max(500),
    reservedInputTokens: z.number().int().min(0),
    reservedOutputTokens: z.number().int().min(0),
    reservedCostUsd: z.number().finite().min(0),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.evidenceIds).size !== input.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "Evidence identifiers must be unique.",
      });
    }
  });

const finalizeInputSchema = authoritySchema
  .extend({
    purpose: modelCallPurposeSchema,
    attemptNumber: z.number().int().min(1).max(2),
    routeAttempt: routeAttemptSchema,
    callId: identifierSchema,
    requestFingerprint: sha256Schema,
    audit: modelCallAuditSchema,
  })
  .strict();

const getInputSchema = z
  .object({
    runId: identifierSchema,
    purpose: modelCallPurposeSchema,
    attemptNumber: z.number().int().min(1).max(2),
    routeAttempt: routeAttemptSchema,
  })
  .strict();

const responseIdentitySchema = intentIdentitySchema.extend({
  runId: identifierSchema,
});
const preparedResponseSchema = responseIdentitySchema
  .extend({
    status: z.literal("prepared"),
    reservedAt: isoTimestampSchema,
  })
  .strict();
const reservedResponseSchema = responseIdentitySchema
  .extend({
    status: z.literal("reserved"),
    reservedAt: isoTimestampSchema,
  })
  .strict();
const completedPrepareResponseSchema = responseIdentitySchema
  .extend({
    status: z.literal("completed"),
    audit: modelCallAuditSchema,
  })
  .strict();
const prepareResponseSchema = z.discriminatedUnion("status", [
  preparedResponseSchema,
  reservedResponseSchema,
  completedPrepareResponseSchema,
]);

const finalizeResponseSchema = responseIdentitySchema
  .extend({
    status: z.literal("completed"),
    created: z.boolean(),
    audit: modelCallAuditSchema,
  })
  .strict();

const readReservedResponseSchema = responseIdentitySchema
  .extend({
    status: z.literal("reserved"),
    reservedAt: isoTimestampSchema,
  })
  .strict();
const readCompletedResponseSchema = responseIdentitySchema
  .extend({
    status: z.literal("completed"),
    reservedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema,
    audit: modelCallAuditSchema,
  })
  .strict();
const readResponseSchema = z.union([
  readReservedResponseSchema,
  readCompletedResponseSchema,
]);

const rpcResultSchema = z
  .object({
    data: z.unknown(),
    error: z
      .object({
        code: z.string().max(128).optional(),
        message: z.string().max(256).optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type SupabaseModelInvocationAuthority = z.infer<typeof authoritySchema>;

export type SupabasePrepareModelInvocationInput =
  SupabaseModelInvocationAuthority &
    Readonly<{
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
    }>;

export type SupabaseFinalizeModelInvocationInput =
  SupabaseModelInvocationAuthority &
    Readonly<{
      purpose: ModelCallPurpose;
      attemptNumber: number;
      routeAttempt: number;
      callId: string;
      requestFingerprint: string;
      audit: ModelCallAudit;
    }>;

export type SupabaseGetModelInvocationInput = Readonly<{
  runId: string;
  purpose: ModelCallPurpose;
  attemptNumber: number;
  routeAttempt: number;
}>;

type InvocationReceiptIdentity = Readonly<{
  runId: string;
  callId: string;
  purpose: ModelCallPurpose;
  attemptNumber: number;
  routeAttempt: number;
  requestFingerprint: string;
}>;

export type SupabasePrepareModelInvocationReceipt =
  | (InvocationReceiptIdentity &
      Readonly<{ status: "prepared"; mayInvoke: true; reservedAt: string }>)
  | (InvocationReceiptIdentity &
      Readonly<{ status: "reserved"; mayInvoke: false; reservedAt: string }>)
  | (InvocationReceiptIdentity &
      Readonly<{ status: "completed"; mayInvoke: false; audit: ModelCallAudit }>);

export type SupabaseFinalizeModelInvocationReceipt = InvocationReceiptIdentity &
  Readonly<{
    status: "completed";
    created: boolean;
    audit: ModelCallAudit;
  }>;

export type SupabaseGetModelInvocationReceipt =
  | (InvocationReceiptIdentity &
      Readonly<{ status: "reserved"; reservedAt: string }>)
  | (InvocationReceiptIdentity &
      Readonly<{
        status: "completed";
        reservedAt: string;
        completedAt: string;
        audit: ModelCallAudit;
      }>)
  | null;

export const supabaseModelInvocationErrorCodes = [
  "INVALID_MODEL_INVOCATION_INPUT",
  "LEASE_NOT_FOUND",
  "RUN_ID_MISMATCH",
  "LEASE_TOKEN_MISMATCH",
  "FENCE_MISMATCH",
  "STALE_JOURNAL_REVISION",
  "LEASE_EXPIRED",
  "ACTIVE_JOURNAL_REQUIRED",
  "INVALID_INVOCATION_INPUT",
  "INVALID_INVOCATION_AUDIT",
  "INVALID_INVOCATION_LINEAGE",
  "INVOCATION_BUDGET_EXCEEDED",
  "INVALID_MODEL_AUDIT_LINEAGE",
  "INVOCATION_NOT_FOUND",
  "INVOCATION_CONFLICT",
  "RPC_PERMISSION_DENIED",
  "MODEL_INVOCATION_TIMEOUT_AMBIGUOUS",
  "MODEL_INVOCATION_STATE_AMBIGUOUS",
] as const;

export type SupabaseModelInvocationErrorCode =
  (typeof supabaseModelInvocationErrorCodes)[number];

const domainErrorCodes = new Set<SupabaseModelInvocationErrorCode>([
  "LEASE_NOT_FOUND",
  "RUN_ID_MISMATCH",
  "LEASE_TOKEN_MISMATCH",
  "FENCE_MISMATCH",
  "STALE_JOURNAL_REVISION",
  "LEASE_EXPIRED",
  "ACTIVE_JOURNAL_REQUIRED",
  "INVALID_INVOCATION_INPUT",
  "INVALID_INVOCATION_AUDIT",
  "INVALID_INVOCATION_LINEAGE",
  "INVOCATION_BUDGET_EXCEEDED",
  "INVALID_MODEL_AUDIT_LINEAGE",
  "INVOCATION_NOT_FOUND",
  "INVOCATION_CONFLICT",
]);
const permissionErrorCodes = new Set([
  "401",
  "403",
  "42501",
  "PGRST301",
  "PGRST302",
]);

export class SupabaseModelInvocationError extends Error {
  readonly retryable = false;
  readonly ambiguous: boolean;

  constructor(readonly code: SupabaseModelInvocationErrorCode) {
    super(code);
    this.name = "SupabaseModelInvocationError";
    this.ambiguous = code.endsWith("_AMBIGUOUS");
  }
}

function mappedRpcError(
  error: SupabaseModelInvocationRpcError,
): SupabaseModelInvocationError {
  const domainCandidate = [error.code, error.message].find(
    (candidate): candidate is SupabaseModelInvocationErrorCode =>
      typeof candidate === "string" &&
      domainErrorCodes.has(candidate as SupabaseModelInvocationErrorCode),
  );
  if (domainCandidate !== undefined) {
    return new SupabaseModelInvocationError(domainCandidate);
  }
  if (error.code === "MODEL_INVOCATION_TIMEOUT_AMBIGUOUS") {
    return new SupabaseModelInvocationError(
      "MODEL_INVOCATION_TIMEOUT_AMBIGUOUS",
    );
  }
  if (error.code !== undefined && permissionErrorCodes.has(error.code)) {
    return new SupabaseModelInvocationError("RPC_PERMISSION_DENIED");
  }
  return new SupabaseModelInvocationError("MODEL_INVOCATION_STATE_AMBIGUOUS");
}

async function callRpc(
  dataSource: SupabaseModelInvocationRpcDataSource,
  name: SupabaseModelInvocationRpcName,
  parameters: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  let result: SupabaseModelInvocationRpcResult;
  try {
    result = await dataSource.rpc(name, parameters);
  } catch {
    throw new SupabaseModelInvocationError("MODEL_INVOCATION_STATE_AMBIGUOUS");
  }
  const parsed = rpcResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new SupabaseModelInvocationError("MODEL_INVOCATION_STATE_AMBIGUOUS");
  }
  if (parsed.data.error !== null) throw mappedRpcError(parsed.data.error);
  return parsed.data.data;
}

function auditMatchesIdentity(
  audit: ModelCallAudit,
  identity: Readonly<{
    callId: string;
    purpose: ModelCallPurpose;
    attemptNumber: number;
    routeAttempt: number;
  }>,
): boolean {
  return (
    audit.callId === identity.callId &&
    audit.purpose === identity.purpose &&
    audit.attemptNumber === identity.attemptNumber &&
    (audit.routeAttempt ?? 1) === identity.routeAttempt
  );
}

function responseMatchesInput(
  response: z.infer<typeof responseIdentitySchema>,
  input: Readonly<{
    runId: string;
    purpose: ModelCallPurpose;
    attemptNumber: number;
    routeAttempt: number;
    callId?: string;
    requestFingerprint?: string;
  }>,
): boolean {
  return (
    response.runId === input.runId &&
    response.purpose === input.purpose &&
    response.attemptNumber === input.attemptNumber &&
    response.routeAttempt === input.routeAttempt &&
    (input.callId === undefined || response.callId === input.callId) &&
    (input.requestFingerprint === undefined ||
      response.requestFingerprint === input.requestFingerprint)
  );
}

/**
 * Server-only model invocation ledger. Only a fresh `prepared` receipt permits
 * one provider call. `reserved` and ambiguous errors must fail closed.
 */
export class SupabaseModelInvocationRepository {
  constructor(private readonly dataSource: SupabaseModelInvocationRpcDataSource) {}

  async prepare(
    input: SupabasePrepareModelInvocationInput,
  ): Promise<SupabasePrepareModelInvocationReceipt> {
    const parsed = prepareInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new SupabaseModelInvocationError("INVALID_MODEL_INVOCATION_INPUT");
    }
    const data = await callRpc(this.dataSource, "prepare_model_invocation", {
      p_run_date: parsed.data.runDate,
      p_run_id: parsed.data.runId,
      p_lease_token: parsed.data.leaseToken,
      p_fence: parsed.data.fence,
      p_expected_revision: parsed.data.expectedRevision,
      p_purpose: parsed.data.purpose,
      p_attempt_number: parsed.data.attemptNumber,
      p_route_attempt: parsed.data.routeAttempt,
      p_call_id: parsed.data.callId,
      p_provider_id: parsed.data.providerId,
      p_model_id: parsed.data.modelId,
      p_prompt_version: parsed.data.promptVersion,
      p_evidence_ids: parsed.data.evidenceIds,
      p_request_fingerprint: parsed.data.requestFingerprint,
      p_score_output_reference: parsed.data.scoreOutputReference,
      p_reserved_input_tokens: parsed.data.reservedInputTokens,
      p_reserved_output_tokens: parsed.data.reservedOutputTokens,
      p_reserved_cost_usd: parsed.data.reservedCostUsd,
    });
    const response = prepareResponseSchema.safeParse(data);
    if (
      !response.success ||
      !responseMatchesInput(response.data, parsed.data) ||
      (response.data.status === "completed" &&
        !auditMatchesIdentity(response.data.audit, response.data))
    ) {
      throw new SupabaseModelInvocationError("MODEL_INVOCATION_STATE_AMBIGUOUS");
    }
    return structuredClone({
      ...response.data,
      mayInvoke: response.data.status === "prepared",
    } as SupabasePrepareModelInvocationReceipt);
  }

  async finalize(
    input: SupabaseFinalizeModelInvocationInput,
  ): Promise<SupabaseFinalizeModelInvocationReceipt> {
    const parsed = finalizeInputSchema.safeParse(input);
    if (
      !parsed.success ||
      !auditMatchesIdentity(parsed.data.audit, parsed.data)
    ) {
      throw new SupabaseModelInvocationError("INVALID_MODEL_INVOCATION_INPUT");
    }
    const normalizedAudit = modelCallAuditSchema.parse({
      ...parsed.data.audit,
      routeAttempt: parsed.data.routeAttempt,
    });
    const data = await callRpc(this.dataSource, "finalize_model_invocation", {
      p_run_date: parsed.data.runDate,
      p_run_id: parsed.data.runId,
      p_lease_token: parsed.data.leaseToken,
      p_fence: parsed.data.fence,
      p_expected_revision: parsed.data.expectedRevision,
      p_purpose: parsed.data.purpose,
      p_attempt_number: parsed.data.attemptNumber,
      p_route_attempt: parsed.data.routeAttempt,
      p_call_id: parsed.data.callId,
      p_request_fingerprint: parsed.data.requestFingerprint,
      p_audit: normalizedAudit,
    });
    const response = finalizeResponseSchema.safeParse(data);
    if (
      !response.success ||
      !responseMatchesInput(response.data, parsed.data) ||
      !auditMatchesIdentity(response.data.audit, parsed.data) ||
      JSON.stringify(response.data.audit) !== JSON.stringify(normalizedAudit)
    ) {
      throw new SupabaseModelInvocationError("MODEL_INVOCATION_STATE_AMBIGUOUS");
    }
    return structuredClone(response.data);
  }

  async get(
    input: SupabaseGetModelInvocationInput,
  ): Promise<SupabaseGetModelInvocationReceipt> {
    const parsed = getInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new SupabaseModelInvocationError("INVALID_MODEL_INVOCATION_INPUT");
    }
    const data = await callRpc(this.dataSource, "get_model_invocation", {
      p_run_id: parsed.data.runId,
      p_purpose: parsed.data.purpose,
      p_attempt_number: parsed.data.attemptNumber,
      p_route_attempt: parsed.data.routeAttempt,
    });
    if (data === null) return null;
    const response = readResponseSchema.safeParse(data);
    if (
      !response.success ||
      !responseMatchesInput(response.data, parsed.data) ||
      (response.data.status === "completed" &&
        !auditMatchesIdentity(response.data.audit, response.data))
    ) {
      throw new SupabaseModelInvocationError("MODEL_INVOCATION_STATE_AMBIGUOUS");
    }
    return structuredClone(response.data);
  }
}
