import { z } from "zod";

import { identifierSchema, isoTimestampSchema } from "../contracts";

export const SUPABASE_SOURCE_ATTEMPT_RPC_NAME =
  "reserve_source_collection_attempt" as const;

export type SupabaseSourceAttemptRpcResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string; message?: string }> | null;
}>;

export interface SupabaseSourceAttemptRpcDataSource {
  rpc(
    functionName: typeof SUPABASE_SOURCE_ATTEMPT_RPC_NAME,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseSourceAttemptRpcResult>;
}

const minIntervalMsSchema = z.number().int().min(60_000).max(604_800_000);

const allowedSchema = z
  .object({
    status: z.literal("allowed"),
    sourceId: identifierSchema,
    lastAttemptAt: isoTimestampSchema,
    nextAllowedAt: isoTimestampSchema,
  })
  .strict();

const tooSoonSchema = z
  .object({
    status: z.literal("too_soon"),
    code: z.literal("TOO_SOON"),
    sourceId: identifierSchema,
    lastAttemptAt: isoTimestampSchema,
    nextAllowedAt: isoTimestampSchema,
  })
  .strict();

const reservationSchema = z.discriminatedUnion("status", [
  allowedSchema,
  tooSoonSchema,
]);

export type SourceAttemptReservation = z.infer<typeof reservationSchema>;

export class SupabaseSourceAttemptError extends Error {
  constructor(readonly code: "STORE_UNAVAILABLE" | "INVALID_INPUT") {
    super(`Supabase source attempt reservation failed. (${code})`);
    this.name = "SupabaseSourceAttemptError";
  }
}

function unavailable(): SupabaseSourceAttemptError {
  return new SupabaseSourceAttemptError("STORE_UNAVAILABLE");
}

export class SupabaseSourceAttemptRepository {
  constructor(private readonly dataSource: SupabaseSourceAttemptRpcDataSource) {}

  async reserve(input: {
    sourceId: string;
    minIntervalMs: number;
  }): Promise<SourceAttemptReservation> {
    const sourceId = identifierSchema.safeParse(input.sourceId);
    const minIntervalMs = minIntervalMsSchema.safeParse(input.minIntervalMs);
    if (!sourceId.success || !minIntervalMs.success) {
      throw new SupabaseSourceAttemptError("INVALID_INPUT");
    }

    let response: SupabaseSourceAttemptRpcResult;
    try {
      response = await this.dataSource.rpc(SUPABASE_SOURCE_ATTEMPT_RPC_NAME, {
        p_source_id: sourceId.data,
        p_min_interval_ms: minIntervalMs.data,
      });
    } catch {
      throw unavailable();
    }

    if (response.error !== null) {
      throw unavailable();
    }

    const parsed = reservationSchema.safeParse(response.data);
    if (!parsed.success || parsed.data.sourceId !== sourceId.data) {
      throw unavailable();
    }

    const reservation = parsed.data;
    const returnedIntervalMs =
      Date.parse(reservation.nextAllowedAt) -
      Date.parse(reservation.lastAttemptAt);
    if (
      !Number.isSafeInteger(returnedIntervalMs) ||
      returnedIntervalMs !== minIntervalMs.data
    ) {
      throw unavailable();
    }

    return structuredClone(reservation);
  }
}
