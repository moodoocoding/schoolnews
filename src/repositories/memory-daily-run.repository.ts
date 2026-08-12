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
  DailyRunStoreError,
  type AcquireDailyRunLeaseInput,
  type CheckpointDailyRunInput,
  type DailyRunAcquireResult,
  type DailyRunStore,
  type FinishDailyRunInput,
} from "../pipeline/orchestrator/daily-run-store";

const TERMINAL_RUN_STATUSES = new Set<DailyRunJournal["run"]["status"]>([
  "succeeded",
  "succeeded_without_publish",
  "published_with_warning",
  "failed",
  "blocked",
]);
const fenceSchema = z.number().int().min(1);

function parseJournal(journal: DailyRunJournal): DailyRunJournal {
  return structuredClone(dailyRunJournalSchema.parse(journal));
}

function parseLease(lease: DailyRunLease): DailyRunLease {
  return structuredClone(dailyRunLeaseSchema.parse(lease));
}

function isTerminal(journal: DailyRunJournal): boolean {
  return TERMINAL_RUN_STATUSES.has(journal.run.status);
}

function assertSameInitialRun(
  lease: DailyRunLease,
  journal: DailyRunJournal,
): void {
  if (
    lease.runId !== journal.run.runId ||
    lease.runDate !== journal.run.runDate
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
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertJournalTransition(
  storedJournal: DailyRunJournal,
  nextJournal: DailyRunJournal,
): void {
  if (nextJournal.revision !== storedJournal.revision + 1) {
    throw new DailyRunStoreError("STALE_JOURNAL_REVISION");
  }

  const storedUsage = storedJournal.run.usage;
  const nextUsage = nextJournal.run.usage;
  const usageRegressed =
    nextUsage.modelCalls < storedUsage.modelCalls ||
    nextUsage.inputTokens < storedUsage.inputTokens ||
    nextUsage.outputTokens < storedUsage.outputTokens ||
    nextUsage.estimatedCostUsd < storedUsage.estimatedCostUsd ||
    (storedUsage.hasUnpricedCalls && !nextUsage.hasUnpricedCalls);
  const attemptsRegressed =
    nextJournal.attempts.length < storedJournal.attempts.length ||
    storedJournal.attempts.some(
      (attempt, index) => !sameValue(attempt, nextJournal.attempts[index]),
    );
  const succeededStepChanged = storedJournal.run.steps
    .filter((step) => step.status === "succeeded")
    .some((step) => {
      const nextStep = nextJournal.run.steps.find(
        (candidate) => candidate.stage === step.stage,
      );
      return nextStep === undefined || !sameValue(step, nextStep);
    });
  const terminalReasonChanged =
    storedJournal.terminalReason !== null &&
    nextJournal.terminalReason !== storedJournal.terminalReason;
  const immutableRunDefinitionChanged =
    storedJournal.schemaVersion !== nextJournal.schemaVersion ||
    storedJournal.startedAt !== nextJournal.startedAt ||
    storedJournal.run.runId !== nextJournal.run.runId ||
    storedJournal.run.runDate !== nextJournal.run.runDate ||
    storedJournal.run.pipelineVersion !== nextJournal.run.pipelineVersion ||
    !sameValue(storedJournal.run.limits, nextJournal.run.limits) ||
    !sameValue(
      storedJournal.run.steps.map((step) => step.stage),
      nextJournal.run.steps.map((step) => step.stage),
    );
  const timestampRegressed =
    Date.parse(nextJournal.updatedAt) < Date.parse(storedJournal.updatedAt);

  if (
    usageRegressed ||
    attemptsRegressed ||
    succeededStepChanged ||
    terminalReasonChanged ||
    immutableRunDefinitionChanged ||
    timestampRegressed
  ) {
    throw new DailyRunStoreError("JOURNAL_REGRESSION");
  }
}

/**
 * Process-local M4 adapter. Every mutation is completed synchronously before
 * the async method returns, so competing calls on one instance cannot
 * interleave inside an acquire/checkpoint/finish transition.
 */
export class MemoryDailyRunRepository implements DailyRunStore {
  readonly #journalsByRunDate = new Map<string, DailyRunJournal>();
  readonly #leasesByRunDate = new Map<string, DailyRunLease>();

  async acquireLease(
    input: Readonly<AcquireDailyRunLeaseInput>,
  ): Promise<DailyRunAcquireResult> {
    const requestedLease = parseLease(input.lease);
    const initialJournal = parseJournal(input.initialJournal);
    const now = isoTimestampSchema.parse(input.now);
    const nowMs = Date.parse(now);

    if (Date.parse(requestedLease.expiresAt) <= nowMs) {
      throw new DailyRunStoreError("LEASE_EXPIRED");
    }

    const storedJournal = this.#journalsByRunDate.get(requestedLease.runDate);
    const storedLease = this.#leasesByRunDate.get(requestedLease.runDate);

    if (storedJournal !== undefined && isTerminal(storedJournal)) {
      return {
        status: "terminal",
        journal: parseJournal(storedJournal),
      };
    }

    if (
      storedLease !== undefined &&
      Date.parse(storedLease.expiresAt) > nowMs
    ) {
      return {
        status: "busy",
        runId: storedLease.runId,
        ownerId: storedLease.ownerId,
        expiresAt: storedLease.expiresAt,
      };
    }

    if (storedJournal !== undefined) {
      if (storedLease === undefined) {
        throw new DailyRunStoreError("LEASE_NOT_FOUND");
      }
      const recoveredLease = parseLease({
        ...requestedLease,
        runId: storedJournal.run.runId,
        fence: storedLease.fence + 1,
      });
      this.#leasesByRunDate.set(
        recoveredLease.runDate,
        parseLease(recoveredLease),
      );
      return {
        status: "acquired",
        lease: parseLease(recoveredLease),
        journal: parseJournal(storedJournal),
        recoveredExpiredLease: true,
      };
    }

    assertSameInitialRun(requestedLease, initialJournal);
    const firstLease = parseLease({ ...requestedLease, fence: 1 });
    this.#journalsByRunDate.set(
      firstLease.runDate,
      parseJournal(initialJournal),
    );
    this.#leasesByRunDate.set(
      firstLease.runDate,
      parseLease(firstLease),
    );

    return {
      status: "acquired",
      lease: parseLease(firstLease),
      journal: parseJournal(initialJournal),
      recoveredExpiredLease: false,
    };
  }

  async checkpoint(
    input: Readonly<CheckpointDailyRunInput>,
  ): Promise<{ journal: DailyRunJournal; lease: DailyRunLease }> {
    const leaseToken = identifierSchema.parse(input.leaseToken);
    const fence = fenceSchema.parse(input.fence);
    const nextJournal = parseJournal(input.journal);
    const renewedAt = isoTimestampSchema.parse(input.renewedAt);
    const renewedExpiresAt = isoTimestampSchema.parse(input.renewedExpiresAt);
    const runDate = nextJournal.run.runDate;
    const storedJournal = this.#journalsByRunDate.get(runDate);
    const storedLease = this.#leasesByRunDate.get(runDate);

    if (storedJournal === undefined || storedLease === undefined) {
      throw new DailyRunStoreError("LEASE_NOT_FOUND");
    }
    if (storedLease.leaseToken !== leaseToken) {
      throw new DailyRunStoreError("LEASE_TOKEN_MISMATCH");
    }
    if (storedLease.fence !== fence) {
      throw new DailyRunStoreError("FENCE_MISMATCH");
    }
    if (
      storedLease.runDate !== runDate ||
      storedJournal.run.runDate !== runDate ||
      storedLease.runId !== nextJournal.run.runId ||
      storedJournal.run.runId !== nextJournal.run.runId
    ) {
      throw new DailyRunStoreError("RUN_ID_MISMATCH");
    }
    if (isTerminal(nextJournal)) {
      throw new DailyRunStoreError("ACTIVE_JOURNAL_REQUIRED");
    }
    assertJournalTransition(storedJournal, nextJournal);
    if (Date.parse(storedLease.expiresAt) <= Date.parse(renewedAt)) {
      throw new DailyRunStoreError("LEASE_EXPIRED");
    }

    const renewedLease = parseLease({
      ...storedLease,
      acquiredAt: renewedAt,
      expiresAt: renewedExpiresAt,
    });
    const storedNextJournal = parseJournal(nextJournal);

    this.#journalsByRunDate.set(runDate, storedNextJournal);
    this.#leasesByRunDate.set(runDate, renewedLease);

    return {
      journal: parseJournal(storedNextJournal),
      lease: parseLease(renewedLease),
    };
  }

  async finish(
    input: Readonly<FinishDailyRunInput>,
  ): Promise<DailyRunJournal> {
    const leaseToken = identifierSchema.parse(input.leaseToken);
    const fence = fenceSchema.parse(input.fence);
    const now = isoTimestampSchema.parse(input.now);
    const terminalJournal = parseJournal(input.journal);
    const runDate = terminalJournal.run.runDate;
    const storedJournal = this.#journalsByRunDate.get(runDate);
    const storedLease = this.#leasesByRunDate.get(runDate);

    if (storedJournal === undefined || storedLease === undefined) {
      throw new DailyRunStoreError("LEASE_NOT_FOUND");
    }
    if (storedLease.leaseToken !== leaseToken) {
      throw new DailyRunStoreError("LEASE_TOKEN_MISMATCH");
    }
    if (storedLease.fence !== fence) {
      throw new DailyRunStoreError("FENCE_MISMATCH");
    }
    if (Date.parse(storedLease.expiresAt) <= Date.parse(now)) {
      throw new DailyRunStoreError("LEASE_EXPIRED");
    }
    if (
      storedLease.runDate !== runDate ||
      storedJournal.run.runDate !== runDate ||
      storedLease.runId !== terminalJournal.run.runId ||
      storedJournal.run.runId !== terminalJournal.run.runId
    ) {
      throw new DailyRunStoreError("RUN_ID_MISMATCH");
    }
    assertJournalTransition(storedJournal, terminalJournal);
    if (
      !isTerminal(terminalJournal) ||
      terminalJournal.run.currentStage !== null ||
      terminalJournal.finishedAt === null
    ) {
      throw new DailyRunStoreError("TERMINAL_JOURNAL_REQUIRED");
    }

    const storedTerminalJournal = parseJournal(terminalJournal);
    this.#journalsByRunDate.set(runDate, storedTerminalJournal);
    this.#leasesByRunDate.delete(runDate);
    return parseJournal(storedTerminalJournal);
  }

  async get(runDate: string): Promise<DailyRunJournal | null> {
    const parsedRunDate = publicationDateKstSchema.parse(runDate);
    const journal = this.#journalsByRunDate.get(parsedRunDate);
    return journal === undefined ? null : parseJournal(journal);
  }
}

export { MemoryDailyRunRepository as MemoryDailyRunStore };
