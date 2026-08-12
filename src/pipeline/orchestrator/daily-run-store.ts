import type {
  DailyRunJournal,
  DailyRunLease,
  PipelineRunState,
} from "../../contracts";

export type DailyRunAcquireResult =
  | {
      status: "acquired";
      lease: DailyRunLease;
      journal: DailyRunJournal;
      recoveredExpiredLease: boolean;
    }
  | {
      status: "busy";
      runId: string;
      ownerId: string;
      expiresAt: string;
    }
  | {
      status: "terminal";
      journal: DailyRunJournal;
    };

export interface AcquireDailyRunLeaseInput {
  lease: DailyRunLease;
  initialJournal: DailyRunJournal;
  now: string;
}

export interface CheckpointDailyRunInput {
  leaseToken: string;
  fence: number;
  journal: DailyRunJournal;
  renewedAt: string;
  renewedExpiresAt: string;
}

export interface FinishDailyRunInput {
  leaseToken: string;
  fence: number;
  journal: DailyRunJournal;
  now: string;
}

export interface DailyRunStore {
  acquireLease(
    input: Readonly<AcquireDailyRunLeaseInput>,
  ): Promise<DailyRunAcquireResult>;
  checkpoint(
    input: Readonly<CheckpointDailyRunInput>,
  ): Promise<{ journal: DailyRunJournal; lease: DailyRunLease }>;
  finish(input: Readonly<FinishDailyRunInput>): Promise<DailyRunJournal>;
  get(runDate: string): Promise<DailyRunJournal | null>;
}

export const dailyRunStoreErrorCodes = [
  "LEASE_NOT_FOUND",
  "LEASE_TOKEN_MISMATCH",
  "FENCE_MISMATCH",
  "LEASE_EXPIRED",
  "RUN_ID_MISMATCH",
  "STALE_JOURNAL_REVISION",
  "JOURNAL_REGRESSION",
  "ACTIVE_JOURNAL_REQUIRED",
  "TERMINAL_JOURNAL_REQUIRED",
  "STORE_UNAVAILABLE",
] as const;

export type DailyRunStoreErrorCode =
  (typeof dailyRunStoreErrorCodes)[number];

export class DailyRunStoreError extends Error {
  readonly code: DailyRunStoreErrorCode;

  constructor(code: DailyRunStoreErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "DailyRunStoreError";
    this.code = code;
  }
}

export type DailyPipelineLimits = PipelineRunState["limits"];
