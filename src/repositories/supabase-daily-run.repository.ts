import { z } from "zod";

import {
  dailyRunJournalSchema,
  dailyRunLeaseSchema,
  identifierSchema,
  isoTimestampSchema,
  publicationDateKstSchema,
  type DailyRunJournal,
  type DailyRunLease,
} from "../contracts";
import {
  dailyRunStoreErrorCodes,
  DailyRunStoreError,
  type AcquireDailyRunLeaseInput,
  type CheckpointDailyRunInput,
  type DailyRunAcquireResult,
  type DailyRunStore,
  type DailyRunStoreErrorCode,
  type FinishDailyRunInput,
} from "../pipeline/orchestrator/daily-run-store";

export const supabaseDailyRunRpcNames = {
  acquire: "acquire_daily_run",
  checkpoint: "checkpoint_daily_run",
  finish: "finish_daily_run",
  get: "get_daily_run",
} as const;

export type SupabaseDailyRunRpcName =
  (typeof supabaseDailyRunRpcNames)[keyof typeof supabaseDailyRunRpcNames];

export type SupabaseDailyRunRpcError = Readonly<{
  code?: string;
  message?: string;
}>;

export type SupabaseDailyRunRpcResult = Readonly<{
  data: unknown;
  error: SupabaseDailyRunRpcError | null;
}>;

/**
 * Small injectable boundary compatible with a wrapper around Supabase `rpc`.
 * The repository intentionally does not create or retain a Supabase client.
 */
export interface SupabaseDailyRunRpcDataSource {
  rpc(
    functionName: SupabaseDailyRunRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseDailyRunRpcResult>;
}

const fenceSchema = z.number().int().min(1);
const terminalStatuses = new Set<DailyRunJournal["run"]["status"]>([
  "succeeded",
  "succeeded_without_publish",
  "published_with_warning",
  "failed",
  "blocked",
]);
const storeErrorCodeSet = new Set<string>(dailyRunStoreErrorCodes);

const acquiredResponseSchema = z
  .object({
    status: z.literal("acquired"),
    lease: dailyRunLeaseSchema,
    journal: dailyRunJournalSchema,
    recoveredExpiredLease: z.boolean(),
  })
  .strict();

const busyResponseSchema = z
  .object({
    status: z.literal("busy"),
    runDate: publicationDateKstSchema,
    runId: identifierSchema,
    ownerId: identifierSchema,
    expiresAt: isoTimestampSchema,
  })
  .strict();

const terminalResponseSchema = z
  .object({
    status: z.literal("terminal"),
    journal: dailyRunJournalSchema,
  })
  .strict();

const acquireResponseSchema = z.discriminatedUnion("status", [
  acquiredResponseSchema,
  busyResponseSchema,
  terminalResponseSchema,
]);

const checkpointResponseSchema = z
  .object({
    journal: dailyRunJournalSchema,
    lease: dailyRunLeaseSchema,
  })
  .strict();

function storeUnavailable(): DailyRunStoreError {
  return new DailyRunStoreError("STORE_UNAVAILABLE");
}

function mappedRpcError(error: SupabaseDailyRunRpcError): DailyRunStoreError {
  const candidate = storeErrorCodeSet.has(error.code ?? "")
    ? error.code
    : storeErrorCodeSet.has(error.message ?? "")
      ? error.message
      : undefined;

  return new DailyRunStoreError(
    (candidate as DailyRunStoreErrorCode | undefined) ?? "STORE_UNAVAILABLE",
  );
}

function isTerminalJournal(journal: DailyRunJournal): boolean {
  return terminalStatuses.has(journal.run.status);
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw storeUnavailable();
  }
  return structuredClone(parsed.data);
}

function assertInitialInput(
  input: Readonly<AcquireDailyRunLeaseInput>,
): {
  lease: DailyRunLease;
  journal: DailyRunJournal;
  requestedNow: string;
} {
  const lease = dailyRunLeaseSchema.parse(input.lease);
  const journal = dailyRunJournalSchema.parse(input.initialJournal);
  const requestedNow = isoTimestampSchema.parse(input.now);

  if (
    lease.runDate !== journal.run.runDate ||
    lease.runId !== journal.run.runId
  ) {
    throw new DailyRunStoreError("RUN_ID_MISMATCH");
  }
  if (journal.revision !== 0) {
    throw new DailyRunStoreError("STALE_JOURNAL_REVISION");
  }
  if (
    journal.run.status !== "running" ||
    journal.finishedAt !== null ||
    journal.terminalReason !== null ||
    journal.attempts.length !== 0
  ) {
    throw new DailyRunStoreError("ACTIVE_JOURNAL_REQUIRED");
  }

  return { lease, journal, requestedNow };
}

export class SupabaseDailyRunRepository implements DailyRunStore {
  constructor(private readonly dataSource: SupabaseDailyRunRpcDataSource) {}

  async acquireLease(
    input: Readonly<AcquireDailyRunLeaseInput>,
  ): Promise<DailyRunAcquireResult> {
    const { lease, journal, requestedNow } = assertInitialInput(input);
    const response = await this.#rpc(supabaseDailyRunRpcNames.acquire, {
      p_run_date: lease.runDate,
      p_requested_lease: lease,
      p_initial_journal: journal,
      p_requested_now: requestedNow,
    });
    const result = parseResponse(acquireResponseSchema, response);

    if (result.status === "busy") {
      if (result.runDate !== lease.runDate) {
        throw new DailyRunStoreError("RUN_ID_MISMATCH");
      }
      return {
        status: "busy",
        runId: result.runId,
        ownerId: result.ownerId,
        expiresAt: result.expiresAt,
      };
    }

    if (result.status === "terminal") {
      if (
        result.journal.run.runDate !== lease.runDate ||
        !isTerminalJournal(result.journal) ||
        result.journal.finishedAt === null
      ) {
        throw new DailyRunStoreError("RUN_ID_MISMATCH");
      }
      return result;
    }

    if (
      result.lease.runDate !== lease.runDate ||
      result.journal.run.runDate !== lease.runDate ||
      result.lease.runId !== result.journal.run.runId
    ) {
      throw new DailyRunStoreError("RUN_ID_MISMATCH");
    }
    if (result.lease.ownerId !== lease.ownerId) {
      throw new DailyRunStoreError("RUN_ID_MISMATCH");
    }
    if (result.lease.leaseToken !== lease.leaseToken) {
      throw new DailyRunStoreError("LEASE_TOKEN_MISMATCH");
    }
    if (
      (!result.recoveredExpiredLease &&
        (result.lease.runId !== lease.runId ||
          result.lease.fence !== lease.fence ||
          result.journal.run.runId !== journal.run.runId ||
          result.journal.revision !== journal.revision)) ||
      (result.recoveredExpiredLease && result.lease.fence <= lease.fence)
    ) {
      throw new DailyRunStoreError(
        result.recoveredExpiredLease
          ? "FENCE_MISMATCH"
          : "RUN_ID_MISMATCH",
      );
    }
    if (isTerminalJournal(result.journal)) {
      throw new DailyRunStoreError("ACTIVE_JOURNAL_REQUIRED");
    }

    return result;
  }

  async checkpoint(
    input: Readonly<CheckpointDailyRunInput>,
  ): Promise<{ journal: DailyRunJournal; lease: DailyRunLease }> {
    const leaseToken = identifierSchema.parse(input.leaseToken);
    const fence = fenceSchema.parse(input.fence);
    const journal = dailyRunJournalSchema.parse(input.journal);
    const requestedRenewedAt = isoTimestampSchema.parse(input.renewedAt);
    const requestedExpiresAt = isoTimestampSchema.parse(input.renewedExpiresAt);
    if (isTerminalJournal(journal)) {
      throw new DailyRunStoreError("ACTIVE_JOURNAL_REQUIRED");
    }

    const response = await this.#rpc(supabaseDailyRunRpcNames.checkpoint, {
      p_run_date: journal.run.runDate,
      p_run_id: journal.run.runId,
      p_lease_token: leaseToken,
      p_fence: fence,
      p_expected_revision: journal.revision - 1,
      p_journal: journal,
      p_requested_renewed_at: requestedRenewedAt,
      p_requested_expires_at: requestedExpiresAt,
    });
    const result = parseResponse(checkpointResponseSchema, response);

    this.#assertMutationIdentity({
      requestedJournal: journal,
      returnedJournal: result.journal,
      returnedLease: result.lease,
      leaseToken,
      fence,
    });
    if (isTerminalJournal(result.journal)) {
      throw new DailyRunStoreError("ACTIVE_JOURNAL_REQUIRED");
    }

    return result;
  }

  async finish(
    input: Readonly<FinishDailyRunInput>,
  ): Promise<DailyRunJournal> {
    const leaseToken = identifierSchema.parse(input.leaseToken);
    const fence = fenceSchema.parse(input.fence);
    const journal = dailyRunJournalSchema.parse(input.journal);
    const requestedNow = isoTimestampSchema.parse(input.now);
    if (!isTerminalJournal(journal) || journal.finishedAt === null) {
      throw new DailyRunStoreError("TERMINAL_JOURNAL_REQUIRED");
    }

    const response = await this.#rpc(supabaseDailyRunRpcNames.finish, {
      p_run_date: journal.run.runDate,
      p_run_id: journal.run.runId,
      p_lease_token: leaseToken,
      p_fence: fence,
      p_expected_revision: journal.revision - 1,
      p_journal: journal,
      p_requested_now: requestedNow,
    });
    const result = parseResponse(dailyRunJournalSchema, response);

    if (
      result.run.runDate !== journal.run.runDate ||
      result.run.runId !== journal.run.runId
    ) {
      throw new DailyRunStoreError("RUN_ID_MISMATCH");
    }
    if (result.revision !== journal.revision) {
      throw new DailyRunStoreError("STALE_JOURNAL_REVISION");
    }
    if (!isTerminalJournal(result) || result.finishedAt === null) {
      throw new DailyRunStoreError("TERMINAL_JOURNAL_REQUIRED");
    }

    return result;
  }

  async get(runDate: string): Promise<DailyRunJournal | null> {
    const requestedRunDate = publicationDateKstSchema.parse(runDate);
    const response = await this.#rpc(supabaseDailyRunRpcNames.get, {
      p_run_date: requestedRunDate,
    });
    if (response === null) {
      return null;
    }
    const journal = parseResponse(dailyRunJournalSchema, response);
    if (journal.run.runDate !== requestedRunDate) {
      throw new DailyRunStoreError("RUN_ID_MISMATCH");
    }
    return journal;
  }

  #assertMutationIdentity(input: {
    requestedJournal: DailyRunJournal;
    returnedJournal: DailyRunJournal;
    returnedLease: DailyRunLease;
    leaseToken: string;
    fence: number;
  }): void {
    if (
      input.returnedJournal.run.runDate !==
        input.requestedJournal.run.runDate ||
      input.returnedLease.runDate !== input.requestedJournal.run.runDate ||
      input.returnedJournal.run.runId !== input.requestedJournal.run.runId ||
      input.returnedLease.runId !== input.requestedJournal.run.runId
    ) {
      throw new DailyRunStoreError("RUN_ID_MISMATCH");
    }
    if (input.returnedLease.leaseToken !== input.leaseToken) {
      throw new DailyRunStoreError("LEASE_TOKEN_MISMATCH");
    }
    if (input.returnedLease.fence !== input.fence) {
      throw new DailyRunStoreError("FENCE_MISMATCH");
    }
    if (input.returnedJournal.revision !== input.requestedJournal.revision) {
      throw new DailyRunStoreError("STALE_JOURNAL_REVISION");
    }
  }

  async #rpc(
    functionName: SupabaseDailyRunRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    let result: SupabaseDailyRunRpcResult;
    try {
      result = await this.dataSource.rpc(functionName, parameters);
    } catch {
      throw storeUnavailable();
    }

    if (
      result === null ||
      typeof result !== "object" ||
      !("error" in result) ||
      !("data" in result)
    ) {
      throw storeUnavailable();
    }
    if (result.error !== null) {
      throw mappedRpcError(result.error);
    }
    return result.data;
  }
}
