import { z } from "zod";

import {
  dailyRetryPolicySchema,
  dailyRunJournalSchema,
  dailyRunLeaseSchema,
  getPublicationDateKst,
  identifierSchema,
  isoTimestampSchema,
  pipelineErrorCodeSchema,
  pipelineStageSchema,
  publicationDateKstSchema,
  sha256Schema,
  type DailyRetryPolicy,
  type DailyRunAttempt,
  type DailyRunJournal,
  type DailyRunLease,
  type PipelineErrorCode,
  type PipelineStage,
} from "../../contracts";
import {
  DailyRunStoreError,
  type DailyPipelineLimits,
  type DailyRunStore,
} from "./daily-run-store";

export const DAILY_PIPELINE_VERSION = "daily-pipeline-v1";

const usageDeltaSchema = z
  .object({
    modelCalls: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    estimatedCostUsd: z.number().min(0),
    hasUnpricedCalls: z.boolean(),
  })
  .strict();

const dailyStageResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("succeeded"),
      inputFingerprint: sha256Schema.nullable(),
      outputReference: z.string().trim().min(1).max(500).nullable(),
      usage: usageDeltaSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("withheld"),
      reason: z.enum([
        "NO_ELIGIBLE_TOPIC",
        "QUALITY_REJECTED",
        "BUDGET_EXCEEDED",
      ]),
      inputFingerprint: sha256Schema.nullable(),
      outputReference: z.string().trim().min(1).max(500).nullable(),
      usage: usageDeltaSchema,
    })
    .strict(),
]);

export type DailyStageResult = z.infer<typeof dailyStageResultSchema>;

export interface DailyStageContext {
  runId: string;
  runDate: string;
  stage: PipelineStage;
  attemptNumber: number;
  signal: AbortSignal;
  limits: DailyPipelineLimits;
  usage: DailyRunJournal["run"]["usage"];
  /** Server-side stores must compare this opaque token without logging it. */
  leaseToken: string;
  leaseFence: number;
  /** Revision persisted after the runner marks this stage as running. */
  journalRevision: number;
}

export type DailyStageFingerprintContext = Pick<
  DailyStageContext,
  "runId" | "runDate" | "stage"
>;

export interface DailyStageDefinition {
  stage: PipelineStage;
  /** Static configuration fingerprint used when no dynamic resolver exists. */
  inputFingerprint: string | null;
  resolveInputFingerprint?(
    context: Readonly<DailyStageFingerprintContext>,
  ): string | null | Promise<string | null>;
  /**
   * Confirms that an interrupted model-capable stage already persisted a
   * reusable result. Without this proof the runner records one unpriced call
   * and blocks instead of risking a duplicate paid invocation.
   */
  canRecoverInterrupted?(
    context: Readonly<DailyStageFingerprintContext>,
  ): boolean | Promise<boolean>;
  /**
   * Reconciles a publish side effect after lease recovery without issuing the
   * publish mutation again. A non-null succeeded result must be backed by an
   * exact durable receipt and is validated like a normal stage result.
   */
  reconcileInterrupted?(
    context: Readonly<DailyStageFingerprintContext>,
    signal: AbortSignal,
  ): DailyStageResult | null | Promise<DailyStageResult | null>;
  retryPolicy: DailyRetryPolicy;
  validateOutputReference(
    outputReference: string | null,
    signal: AbortSignal,
    context?: Readonly<DailyStageFingerprintContext>,
  ): boolean | Promise<boolean>;
  execute(context: Readonly<DailyStageContext>): Promise<DailyStageResult>;
}

export type DailyPipelineEvent =
  | {
      type: "lease_acquired" | "lease_recovered";
      runId: string;
      runDate: string;
    }
  | {
      type: "step_started" | "step_succeeded" | "step_failed";
      runId: string;
      runDate: string;
      stage: PipelineStage;
      attemptNumber: number;
      errorCode: PipelineErrorCode | null;
    }
  | {
      type: "run_finished";
      runId: string;
      runDate: string;
      status: DailyRunJournal["run"]["status"];
    };

export interface RunDailyPipelineOptions {
  store: DailyRunStore;
  stages: readonly DailyStageDefinition[];
  limits: DailyPipelineLimits;
  runDate?: string;
  ownerId?: string;
  leaseDurationMs?: number;
  now?: () => Date;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  createRunId?: (runDate: string) => string;
  createLeaseToken?: () => string;
  abortSignal?: AbortSignal;
  onEvent?: (event: Readonly<DailyPipelineEvent>) => void;
}

export type DailyPipelineResult =
  | { status: "executed"; journal: DailyRunJournal }
  | { status: "already_terminal"; journal: DailyRunJournal }
  | {
      status: "busy";
      runId: string;
      ownerId: string;
      expiresAt: string;
    };

export class DailyStepError extends Error {
  readonly code: PipelineErrorCode;
  readonly retryable: boolean;
  readonly usage: DailyStageResult["usage"] | null;

  constructor(
    code: PipelineErrorCode,
    retryable: boolean,
    options?: ErrorOptions & { usage?: DailyStageResult["usage"] },
  ) {
    super(code, options);
    this.name = "DailyStepError";
    this.code = pipelineErrorCodeSchema.parse(code);
    this.retryable = retryable;
    this.usage = options?.usage
      ? usageDeltaSchema.parse(options.usage)
      : null;
  }
}

/**
 * The remote transaction may still commit after its response was lost. The
 * runner must leave the current lease/journal non-terminal so a later fenced
 * takeover can reconcile the durable artifact instead of issuing the write
 * again or permanently closing the run too early.
 */
export class DailyStageCommitUncertainError extends Error {
  constructor(options?: ErrorOptions) {
    super("DAILY_STAGE_COMMIT_UNCERTAIN", options);
    this.name = "DailyStageCommitUncertainError";
  }
}

const PIPELINE_STAGE_ORDER = new Map(
  pipelineStageSchema.options.map((stage, index) => [stage, index]),
);
const EMPTY_USAGE = {
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  hasUnpricedCalls: false,
} as const;
// The current generate stage owns both generation and the optional semantic
// evaluator. The validate stage is a deterministic publication projection and
// must remain safely replayable without inventing an unpriced model call.
const MODEL_CAPABLE_STAGES = new Set<PipelineStage>(["generate"]);
const LEASE_COMPLETION_SAFETY_MS = 100;

function isZeroUsage(usage: DailyStageResult["usage"]): boolean {
  return (
    usage.modelCalls === 0 &&
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.estimatedCostUsd === 0 &&
    !usage.hasUnpricedCalls
  );
}

async function validateOutputReferenceWithin(
  definition: DailyStageDefinition,
  outputReference: string | null,
  timeoutMs: number,
  outerSignal?: AbortSignal,
  context?: Readonly<DailyStageFingerprintContext>,
): Promise<boolean> {
  if (timeoutMs < 1) return false;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = outerSignal
    ? AbortSignal.any([outerSignal, timeoutSignal])
    : timeoutSignal;
  return await new Promise<boolean>((resolve) => {
    const onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(
      definition.validateOutputReference(outputReference, signal, context),
    )
      .then((valid) => resolve(valid === true))
      .catch(() => resolve(false))
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function reconcileInterruptedWithin(
  definition: DailyStageDefinition,
  context: Readonly<DailyStageFingerprintContext>,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<DailyStageResult | null> {
  if (!definition.reconcileInterrupted || timeoutMs < 1) return null;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = outerSignal
    ? AbortSignal.any([outerSignal, timeoutSignal])
    : timeoutSignal;
  return await new Promise<DailyStageResult | null>((resolve) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(definition.reconcileInterrupted?.(context, signal))
      .then((result) =>
        resolve(result === null ? null : dailyStageResultSchema.parse(result)),
      )
      .catch(() => resolve(null))
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DailyStepError("UNKNOWN_ERROR", false));
      return;
    }
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DailyStepError("UNKNOWN_ERROR", false));
      },
      { once: true },
    );
  });
}

function emit(
  callback: RunDailyPipelineOptions["onEvent"],
  event: DailyPipelineEvent,
): void {
  try {
    callback?.(event);
  } catch {
    // Observability must never change the publishing decision.
  }
}

function addMilliseconds(value: Date, milliseconds: number): string {
  return new Date(value.getTime() + milliseconds).toISOString();
}

function validateStages(
  candidateStages: readonly DailyStageDefinition[],
  leaseDurationMs: number,
): DailyStageDefinition[] {
  if (candidateStages.length === 0) {
    throw new Error("일일 파이프라인에는 하나 이상의 단계가 필요합니다.");
  }
  const stages = candidateStages.map((definition) => ({
    ...definition,
    stage: pipelineStageSchema.parse(definition.stage),
    inputFingerprint: sha256Schema.nullable().parse(
      definition.inputFingerprint,
    ),
    retryPolicy: dailyRetryPolicySchema.parse(definition.retryPolicy),
  }));
  const names = stages.map((stage) => stage.stage);
  if (new Set(names).size !== names.length) {
    throw new Error("일일 파이프라인 단계는 중복될 수 없습니다.");
  }
  if (
    stages.some(
      (stage, index) =>
        index > 0 &&
        (PIPELINE_STAGE_ORDER.get(stages[index - 1].stage) ?? -1) >=
          (PIPELINE_STAGE_ORDER.get(stage.stage) ?? -1),
    )
  ) {
    throw new Error("일일 파이프라인 단계 순서가 올바르지 않습니다.");
  }
  if (
    stages.some(
      ({ retryPolicy }) =>
        retryPolicy.timeoutMs + LEASE_COMPLETION_SAFETY_MS >= leaseDurationMs ||
        retryPolicy.maxDelayMs >= leaseDurationMs,
    )
  ) {
    throw new Error("임대 시간은 단계 제한 시간과 재시도 대기보다 길어야 합니다.");
  }
  const publish = stages.find((stage) => stage.stage === "publish");
  if (publish && publish.retryPolicy.maxAttempts !== 1) {
    throw new Error(
      "영속 발행 멱등성이 연결되기 전 publish 단계는 재시도할 수 없습니다.",
    );
  }
  const publishIndex = stages.findIndex((stage) => stage.stage === "publish");
  const validateIndex = stages.findIndex((stage) => stage.stage === "validate");
  if (publishIndex >= 0 && (validateIndex < 0 || validateIndex > publishIndex)) {
    throw new Error("publish 단계 앞에는 validate 단계가 필요합니다.");
  }
  const cacheIndex = stages.findIndex(
    (stage) => stage.stage === "cache_refresh",
  );
  if (cacheIndex >= 0 && (publishIndex < 0 || publishIndex > cacheIndex)) {
    throw new Error("cache_refresh 단계 앞에는 publish 단계가 필요합니다.");
  }
  return stages;
}

async function resolveStageInputFingerprint(
  definition: DailyStageDefinition,
  context: Readonly<DailyStageFingerprintContext>,
): Promise<string | null> {
  return sha256Schema.nullable().parse(
    definition.resolveInputFingerprint
      ? await definition.resolveInputFingerprint(context)
      : definition.inputFingerprint,
  );
}

function initialJournal(input: {
  runId: string;
  runDate: string;
  startedAt: string;
  stages: readonly DailyStageDefinition[];
  limits: DailyPipelineLimits;
}): DailyRunJournal {
  return dailyRunJournalSchema.parse({
    schemaVersion: "daily-run-v1",
    revision: 0,
    run: {
      runId: input.runId,
      runDate: input.runDate,
      status: "running",
      pipelineVersion: DAILY_PIPELINE_VERSION,
      currentStage: input.stages[0].stage,
      steps: input.stages.map(({ stage }) => ({
        stage,
        status: "pending",
        attemptNumber: 0,
        inputFingerprint: null,
        outputReference: null,
        startedAt: null,
        finishedAt: null,
        errorCode: null,
      })),
      limits: input.limits,
      usage: EMPTY_USAGE,
    },
    attempts: [],
    terminalReason: null,
    startedAt: input.startedAt,
    finishedAt: null,
    updatedAt: input.startedAt,
  });
}

function journalWithUpdate(
  journal: DailyRunJournal,
  updatedAt: string,
  update: (draft: DailyRunJournal) => void,
): DailyRunJournal {
  const draft = structuredClone(journal);
  draft.revision += 1;
  draft.updatedAt = updatedAt;
  update(draft);
  return dailyRunJournalSchema.parse(draft);
}

function nextDelay(policy: DailyRetryPolicy, attemptNumber: number): number {
  return Math.min(
    policy.maxDelayMs,
    Math.round(
      policy.initialDelayMs * policy.multiplier ** (attemptNumber - 1),
    ),
  );
}

function remainingStageNames(
  stages: readonly DailyStageDefinition[],
  afterStage: PipelineStage,
): Set<PipelineStage> {
  const index = stages.findIndex((stage) => stage.stage === afterStage);
  return new Set(stages.slice(index + 1).map((stage) => stage.stage));
}

function appendUsage(
  journal: DailyRunJournal,
  delta: DailyStageResult["usage"],
): void {
  journal.run.usage.modelCalls += delta.modelCalls;
  journal.run.usage.inputTokens += delta.inputTokens;
  journal.run.usage.outputTokens += delta.outputTokens;
  journal.run.usage.estimatedCostUsd += delta.estimatedCostUsd;
  journal.run.usage.hasUnpricedCalls ||= delta.hasUnpricedCalls;
}

function usageExceeded(journal: DailyRunJournal): boolean {
  const { usage, limits } = journal.run;
  return (
    usage.modelCalls > limits.maxModelCalls ||
    usage.inputTokens > limits.maxInputTokens ||
    usage.outputTokens > limits.maxOutputTokens ||
    usage.estimatedCostUsd > limits.maxEstimatedCostUsd ||
    usage.hasUnpricedCalls
  );
}

async function executeWithTimeout(
  definition: DailyStageDefinition,
  context: Omit<DailyStageContext, "signal">,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<DailyStageResult> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = outerSignal
    ? AbortSignal.any([outerSignal, timeoutSignal])
    : timeoutSignal;

  return await new Promise<DailyStageResult>((resolve, reject) => {
    const onAbort = () => {
      if (outerSignal?.aborted) {
        reject(
          new DailyStepError(
            definition.stage === "publish"
              ? "PUBLISH_TIMEOUT_AMBIGUOUS"
              : "RUN_ABORTED",
            false,
          ),
        );
        return;
      }
      const timedOutDuringPublish = definition.stage === "publish";
      reject(
        new DailyStepError(
          timedOutDuringPublish
            ? "PUBLISH_TIMEOUT_AMBIGUOUS"
            : "STAGE_TIMEOUT",
          !timedOutDuringPublish,
        ),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    definition
      .execute({ ...context, signal })
      .then((result) => resolve(dailyStageResultSchema.parse(result)))
      .catch(reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function stepError(error: unknown): DailyStepError {
  return error instanceof DailyStepError
    ? error
    : new DailyStepError("UNKNOWN_ERROR", false, { cause: error });
}

// A stable, safe-to-log diagnostic tag: the error's constructor name plus its
// `code` property when present (e.g. PipelineWorkspaceError's specific
// reason), without ever including payloads, article text or credentials.
function diagnosticErrorTag(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = "code" in error ? String((error as { code: unknown }).code) : null;
  return code ? `${error.name}:${code}` : error.name;
}

/**
 * Runs an injected daily workflow with lease fencing, bounded retries and an
 * immutable attempt journal. This layer does not choose a database or scheduler.
 */
export async function runDailyPipeline(
  options: Readonly<RunDailyPipelineOptions>,
): Promise<DailyPipelineResult> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const leaseDurationMs = options.leaseDurationMs ?? 120_000;
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
    throw new Error("임대 시간은 양의 정수여야 합니다.");
  }
  const stages = validateStages(options.stages, leaseDurationMs);
  const started = now();
  const runDate = publicationDateKstSchema.parse(
    options.runDate ?? getPublicationDateKst(started.toISOString()),
  );
  const ownerId = identifierSchema.parse(options.ownerId ?? "daily-worker");
  let runId = identifierSchema.parse(
    options.createRunId?.(runDate) ?? `daily-${runDate.replaceAll("-", "")}`,
  );
  const leaseToken = identifierSchema.parse(
    options.createLeaseToken?.() ?? `lease-${crypto.randomUUID()}`,
  );
  const initial = initialJournal({
    runId,
    runDate,
    startedAt: started.toISOString(),
    stages,
    limits: options.limits,
  });
  const requestedLease = dailyRunLeaseSchema.parse({
    runDate,
    runId,
    ownerId,
    leaseToken,
    fence: 1,
    acquiredAt: started.toISOString(),
    expiresAt: addMilliseconds(started, leaseDurationMs),
  });
  const acquired = await options.store.acquireLease({
    lease: requestedLease,
    initialJournal: initial,
    now: started.toISOString(),
  });

  if (acquired.status === "busy") {
    return {
      status: "busy",
      runId: identifierSchema.parse(acquired.runId),
      ownerId: identifierSchema.parse(acquired.ownerId),
      expiresAt: isoTimestampSchema.parse(acquired.expiresAt),
    };
  }
  if (acquired.status === "terminal") {
    const terminalJournal = dailyRunJournalSchema.parse(acquired.journal);
    if (
      terminalJournal.run.runDate !== runDate ||
      terminalJournal.finishedAt === null
    ) {
      throw new Error("저장소가 요청과 다른 종료 저널을 반환했습니다.");
    }
    return { status: "already_terminal", journal: terminalJournal };
  }

  runId = identifierSchema.parse(acquired.journal.run.runId);
  let journal = dailyRunJournalSchema.parse(acquired.journal);
  let lease: DailyRunLease = dailyRunLeaseSchema.parse(acquired.lease);
  if (
    journal.run.runDate !== runDate ||
    lease.runDate !== runDate ||
    lease.runId !== journal.run.runId ||
    lease.leaseToken !== leaseToken ||
    lease.ownerId !== ownerId
  ) {
    throw new Error("저장소가 요청과 다른 실행권 또는 저널을 반환했습니다.");
  }
  // journal.startedAt is server-clock authoritative (set via clock_timestamp()
  // by the acquire/checkpoint RPC); `started` is this worker's local clock at
  // the same moment. The gap corrects later deadline comparisons for drift
  // between the worker's clock and the database server's clock.
  const clockOffsetMs = new Date(journal.startedAt).getTime() - started.getTime();
  const serverAdjustedMs = (date: Date): number => date.getTime() + clockOffsetMs;
  const expectedStages = stages.map((stage) => stage.stage);
  emit(options.onEvent, {
    type: acquired.recoveredExpiredLease
      ? "lease_recovered"
      : "lease_acquired",
    runId,
    runDate,
  });

  const checkpoint = async (next: DailyRunJournal): Promise<void> => {
    try {
      const checkpointedAt = now();
      const result = await options.store.checkpoint({
        leaseToken: lease.leaseToken,
        fence: lease.fence,
        journal: next,
        renewedAt: checkpointedAt.toISOString(),
        renewedExpiresAt: addMilliseconds(checkpointedAt, leaseDurationMs),
      });
      const checkpointedJournal = dailyRunJournalSchema.parse(result.journal);
      const renewedLease = dailyRunLeaseSchema.parse(result.lease);
      if (
        checkpointedJournal.run.runDate !== runDate ||
        checkpointedJournal.run.runId !== runId ||
        renewedLease.runDate !== runDate ||
        renewedLease.runId !== runId ||
        renewedLease.leaseToken !== lease.leaseToken ||
        renewedLease.fence !== lease.fence
      ) {
        throw new Error("저장소가 요청과 다른 체크포인트를 반환했습니다.");
      }
      journal = checkpointedJournal;
      lease = renewedLease;
    } catch (error) {
      if (error instanceof DailyRunStoreError) throw error;
      throw new DailyRunStoreError("STORE_UNAVAILABLE", { cause: error });
    }
  };
  const terminalizeIncomplete = (
    draft: DailyRunJournal,
    at: string,
    terminalReason: PipelineErrorCode | null,
  ): void => {
    const errorCode = terminalReason ?? "UNKNOWN_ERROR";
    draft.run.steps.forEach((step) => {
      if (step.status === "pending") {
        step.status = "skipped";
        step.finishedAt = at;
        return;
      }
      if (step.status === "failed_retryable") {
        step.status = "failed";
        return;
      }
      if (step.status !== "running") {
        return;
      }
      step.status = "failed";
      step.finishedAt = at;
      step.errorCode = errorCode;
      const alreadyJournaled = draft.attempts.some(
        (attempt) =>
          attempt.stage === step.stage &&
          attempt.attemptNumber === step.attemptNumber,
      );
      if (!alreadyJournaled) {
        draft.attempts.push({
          stage: step.stage,
          attemptNumber: step.attemptNumber,
          status: "failed",
          inputFingerprint: step.inputFingerprint,
          outputReference: step.outputReference,
          startedAt: step.startedAt ?? at,
          finishedAt: at,
          errorCode,
          retryable: false,
          retryDelayMs: 0,
        });
      }
    });
  };
  const finish = async (
    status: DailyRunJournal["run"]["status"],
    at: Date,
    terminalReason: PipelineErrorCode | null = null,
  ): Promise<DailyPipelineResult> => {
    const finished = journalWithUpdate(journal, at.toISOString(), (draft) => {
      draft.run.status = status;
      draft.run.currentStage = null;
      draft.finishedAt = at.toISOString();
      draft.terminalReason = terminalReason;
      terminalizeIncomplete(draft, at.toISOString(), terminalReason);
    });
    journal = await options.store.finish({
      leaseToken: lease.leaseToken,
      fence: lease.fence,
      journal: finished,
      now: at.toISOString(),
    });
    emit(options.onEvent, { type: "run_finished", runId, runDate, status });
    return { status: "executed", journal };
  };
  const finishPending = async (
    status: DailyRunJournal["run"]["status"],
    at: Date,
    terminalReason: PipelineErrorCode | null = null,
  ): Promise<DailyPipelineResult> => {
    const finished = structuredClone(journal);
    finished.updatedAt = at.toISOString();
    finished.run.status = status;
    finished.run.currentStage = null;
    finished.finishedAt = at.toISOString();
    finished.terminalReason = terminalReason;
    terminalizeIncomplete(finished, at.toISOString(), terminalReason);
    journal = await options.store.finish({
      leaseToken: lease.leaseToken,
      fence: lease.fence,
      journal: dailyRunJournalSchema.parse(finished),
      now: at.toISOString(),
    });
    emit(options.onEvent, { type: "run_finished", runId, runDate, status });
    return { status: "executed", journal };
  };
  const skipAfter = (draft: DailyRunJournal, stage: PipelineStage, at: string) => {
    const remaining = remainingStageNames(stages, stage);
    draft.run.steps.forEach((step) => {
      if (remaining.has(step.stage) && step.status === "pending") {
        step.status = "skipped";
        step.finishedAt = at;
      }
    });
  };

  if (
    JSON.stringify(journal.run.steps.map((step) => step.stage)) !==
    JSON.stringify(expectedStages)
  ) {
    return finish("blocked", now(), "PIPELINE_VERSION_MISMATCH");
  }

  if (journal.run.pipelineVersion !== DAILY_PIPELINE_VERSION) {
    return finish("blocked", now(), "PIPELINE_VERSION_MISMATCH");
  }
  for (const definition of stages) {
    const completed = journal.run.steps.find(
      (step) => step.stage === definition.stage && step.status === "succeeded",
    );
    if (!completed) {
      continue;
    }
    let reusable = false;
    try {
      const expectedInputFingerprint = await resolveStageInputFingerprint(
        definition,
        { runId, runDate, stage: definition.stage },
      );
      const fingerprintMatches =
        completed.inputFingerprint === expectedInputFingerprint;
      const remainingLeaseMs =
        new Date(lease.expiresAt).getTime() - now().getTime();
      const referenceTimeoutMs = Math.floor(
        Math.min(
          definition.retryPolicy.timeoutMs,
          remainingLeaseMs - LEASE_COMPLETION_SAFETY_MS,
        ),
      );
      const referenceValid = await validateOutputReferenceWithin(
        definition,
        completed.outputReference,
        referenceTimeoutMs,
        options.abortSignal,
        { runId, runDate, stage: definition.stage },
      );
      reusable = fingerprintMatches && referenceValid;
      if (!reusable) {
        console.error(
          "daily_stage_reuse_check_failed",
          definition.stage,
          fingerprintMatches,
          referenceValid,
          referenceTimeoutMs,
        );
      }
    } catch (caught) {
      reusable = false;
      console.error(
        "daily_stage_reuse_check_threw",
        definition.stage,
        diagnosticErrorTag(caught),
      );
    }
    if (!reusable) {
      return finish("blocked", now(), "PIPELINE_VERSION_MISMATCH");
    }
  }

  // A model-capable stage that proves (via canRecoverInterrupted) it already
  // durably stored a matching result is granted one extra attempt beyond its
  // normal retry cap, so the engine can pick that result up on the next pass
  // instead of discarding an already-paid-for success. The bonus attempt is
  // safe because the stage's own execute() must detect and reuse the stored
  // artifact rather than invoking the model again.
  const recoveryBonusAttempts = new Map<PipelineStage, number>();

  if (acquired.recoveredExpiredLease) {
    const interrupted = journal.run.steps.find(
      (step) => step.status === "running",
    );
    if (interrupted) {
      const recoveredAt = now();
      const interruptedDefinition = stages.find(
        (definition) => definition.stage === interrupted.stage,
      );
      let reconciledPublish = false;
      let reconciledPublishResult: DailyStageResult | null = null;
      if (
        interrupted.stage === "publish" &&
        interruptedDefinition?.reconcileInterrupted
      ) {
        try {
          const remainingLeaseMs =
            new Date(lease.expiresAt).getTime() - recoveredAt.getTime();
          const timeoutMs = Math.floor(
            Math.min(
              interruptedDefinition.retryPolicy.timeoutMs,
              remainingLeaseMs - LEASE_COMPLETION_SAFETY_MS,
            ),
          );
          if (timeoutMs > 0) {
            const result = await reconcileInterruptedWithin(
              interruptedDefinition,
              { runId, runDate, stage: interrupted.stage },
              timeoutMs,
              options.abortSignal,
            );
            reconciledPublish =
              result !== null &&
              result.outcome === "succeeded" &&
              isZeroUsage(result.usage) &&
              result.inputFingerprint === interrupted.inputFingerprint &&
              (await validateOutputReferenceWithin(
                interruptedDefinition,
                result.outputReference,
                timeoutMs,
                options.abortSignal,
                { runId, runDate, stage: interrupted.stage },
              ));
            if (reconciledPublish) reconciledPublishResult = result;
          }
        } catch {
          reconciledPublish = false;
          reconciledPublishResult = null;
        }
      }
      if (reconciledPublish && reconciledPublishResult !== null) {
        const reconciledAt = now();
        journal = journalWithUpdate(
          journal,
          reconciledAt.toISOString(),
          (draft) => {
            const step = draft.run.steps.find(
              (candidate) => candidate.stage === interrupted.stage,
            );
            if (!step) return;
            step.status = "succeeded";
            step.outputReference = reconciledPublishResult.outputReference;
            step.finishedAt = reconciledAt.toISOString();
            step.errorCode = null;
            draft.run.currentStage = null;
            draft.attempts.push({
              stage: step.stage,
              attemptNumber: step.attemptNumber,
              status: "succeeded",
              inputFingerprint: reconciledPublishResult.inputFingerprint,
              outputReference: reconciledPublishResult.outputReference,
              startedAt: step.startedAt ?? reconciledAt.toISOString(),
              finishedAt: reconciledAt.toISOString(),
              errorCode: null,
              retryable: false,
              retryDelayMs: 0,
            });
          },
        );
        // Do not reinterpret a checkpoint failure as a missing publish
        // receipt. A later lease owner can reconcile the exact receipt again.
        await checkpoint(journal);
        emit(options.onEvent, {
          type: "step_succeeded",
          runId,
          runDate,
          stage: interrupted.stage,
          attemptNumber: interrupted.attemptNumber,
          errorCode: null,
        });
      }
      if (!reconciledPublish) {
        const ambiguousPublish = interrupted.stage === "publish";
        let recoverableModelOutput = false;
        if (
          MODEL_CAPABLE_STAGES.has(interrupted.stage) &&
          interruptedDefinition?.canRecoverInterrupted
        ) {
          try {
            recoverableModelOutput =
              (await interruptedDefinition.canRecoverInterrupted({
                runId,
                runDate,
                stage: interrupted.stage,
              })) === true;
          } catch {
            recoverableModelOutput = false;
          }
        }
        const uncertainModelInvocation =
          MODEL_CAPABLE_STAGES.has(interrupted.stage) &&
          !recoverableModelOutput;
        const canRetry =
          !ambiguousPublish &&
          !uncertainModelInvocation &&
          interrupted.attemptNumber <
            (interruptedDefinition?.retryPolicy.maxAttempts ?? 0) +
              (recoverableModelOutput ? 1 : 0);
        if (canRetry && recoverableModelOutput) {
          recoveryBonusAttempts.set(interrupted.stage, 1);
        }
        journal = journalWithUpdate(
          journal,
          recoveredAt.toISOString(),
          (draft) => {
            const step = draft.run.steps.find(
              (candidate) => candidate.stage === interrupted.stage,
            );
            if (!step) return;
            const errorCode = ambiguousPublish
              ? "PUBLISH_TIMEOUT_AMBIGUOUS"
              : uncertainModelInvocation
                ? "BUDGET_EXCEEDED"
                : "LEASE_EXPIRED";
            if (uncertainModelInvocation) {
              appendUsage(draft, {
                modelCalls: 1,
                inputTokens: 0,
                outputTokens: 0,
                estimatedCostUsd: 0,
                hasUnpricedCalls: true,
              });
            }
            const attempt: DailyRunAttempt = {
              stage: step.stage,
              attemptNumber: step.attemptNumber,
              status: "failed",
              inputFingerprint: step.inputFingerprint,
              outputReference: step.outputReference,
              startedAt: step.startedAt ?? recoveredAt.toISOString(),
              finishedAt: recoveredAt.toISOString(),
              errorCode,
              retryable: canRetry,
              retryDelayMs: 0,
            };
            draft.attempts.push(attempt);
            step.status = canRetry ? "failed_retryable" : "failed";
            step.finishedAt = recoveredAt.toISOString();
            step.errorCode = errorCode;
            draft.run.currentStage = canRetry ? interrupted.stage : null;
            if (!canRetry) {
              skipAfter(draft, interrupted.stage, recoveredAt.toISOString());
            }
          },
        );
        if (ambiguousPublish) {
          return finishPending(
            "blocked",
            now(),
            "PUBLISH_TIMEOUT_AMBIGUOUS",
          );
        }
        if (uncertainModelInvocation) {
          return finishPending("blocked", now(), "BUDGET_EXCEEDED");
        }
        if (!canRetry) {
          const publishAlreadySucceeded = journal.run.steps.some(
            (step) => step.stage === "publish" && step.status === "succeeded",
          );
          return finishPending(
            interrupted.stage === "cache_refresh" && publishAlreadySucceeded
              ? "published_with_warning"
              : "failed",
            now(),
            "LEASE_EXPIRED",
          );
        }
        await checkpoint(journal);
      }
    }
  }

  if (usageExceeded(journal)) {
    return finish("blocked", now(), "BUDGET_EXCEEDED");
  }

  const deadlineAt =
    new Date(journal.startedAt).getTime() +
    journal.run.limits.maxRunSeconds * 1_000;

  for (const definition of stages) {
    const existing = journal.run.steps.find(
      (step) => step.stage === definition.stage,
    );
    if (!existing || existing.status === "succeeded") {
      continue;
    }
    let expectedInputFingerprint: string | null;
    try {
      expectedInputFingerprint = await resolveStageInputFingerprint(
        definition,
        { runId, runDate, stage: definition.stage },
      );
    } catch (caught) {
      // The specific failure must stay visible in server logs instead of
      // being reduced to a single terminal error code with no trace.
      console.error(
        "daily_stage_input_fingerprint_failure",
        definition.stage,
        diagnosticErrorTag(caught),
      );
      return finish("blocked", now(), "INVALID_SOURCE_DATA");
    }
    let attemptNumber =
      Math.max(
        0,
        ...journal.attempts
          .filter((attempt) => attempt.stage === definition.stage)
          .map((attempt) => attempt.attemptNumber),
      ) + 1;
    const effectiveMaxAttempts =
      definition.retryPolicy.maxAttempts +
      (recoveryBonusAttempts.get(definition.stage) ?? 0);

    while (attemptNumber <= effectiveMaxAttempts) {
      const attemptStarted = now();
      if (
        serverAdjustedMs(attemptStarted) >= deadlineAt ||
        options.abortSignal?.aborted
      ) {
        const interruptionCode = options.abortSignal?.aborted
          ? "RUN_ABORTED"
          : "RUN_DEADLINE_EXCEEDED";
        journal = journalWithUpdate(
          journal,
          attemptStarted.toISOString(),
          (draft) => {
            const step = draft.run.steps.find(
              (candidate) => candidate.stage === definition.stage,
            );
            if (!step) return;
            step.status = "failed";
            step.attemptNumber = attemptNumber;
            step.startedAt = attemptStarted.toISOString();
            step.finishedAt = attemptStarted.toISOString();
            step.errorCode = interruptionCode;
            draft.run.currentStage = null;
            draft.attempts.push({
              stage: definition.stage,
              attemptNumber,
              status: "failed",
              inputFingerprint: step.inputFingerprint,
              outputReference: null,
              startedAt: attemptStarted.toISOString(),
              finishedAt: attemptStarted.toISOString(),
              errorCode: interruptionCode,
              retryable: false,
              retryDelayMs: 0,
            });
            skipAfter(draft, definition.stage, attemptStarted.toISOString());
          },
        );
        return finishPending("failed", now(), interruptionCode);
      }

      journal = journalWithUpdate(
        journal,
        attemptStarted.toISOString(),
        (draft) => {
          const step = draft.run.steps.find(
            (candidate) => candidate.stage === definition.stage,
          );
          if (!step) return;
          step.status = "running";
          step.attemptNumber = attemptNumber;
          step.inputFingerprint = expectedInputFingerprint;
          step.startedAt = attemptStarted.toISOString();
          step.finishedAt = null;
          step.errorCode = null;
          draft.run.currentStage = definition.stage;
        },
      );
      await checkpoint(journal);
      emit(options.onEvent, {
        type: "step_started",
        runId,
        runDate,
        stage: definition.stage,
        attemptNumber,
        errorCode: null,
      });

      try {
        const stageCallAt = now();
        const remainingRunMs = deadlineAt - serverAdjustedMs(stageCallAt);
        const remainingLeaseMs =
          new Date(lease.expiresAt).getTime() - stageCallAt.getTime();
        const effectiveTimeoutMs = Math.floor(
          Math.min(
            definition.retryPolicy.timeoutMs,
            remainingRunMs,
            remainingLeaseMs - LEASE_COMPLETION_SAFETY_MS,
          ),
        );
        if (effectiveTimeoutMs < 1) {
          throw new DailyStepError("RUN_DEADLINE_EXCEEDED", false);
        }
        const result = await executeWithTimeout(
          definition,
          {
            runId,
            runDate,
            stage: definition.stage,
            attemptNumber,
            limits: journal.run.limits,
            usage: structuredClone(journal.run.usage),
            leaseToken: lease.leaseToken,
            leaseFence: lease.fence,
            journalRevision: journal.revision,
          },
          effectiveTimeoutMs,
          options.abortSignal,
        );
        if (
          !MODEL_CAPABLE_STAGES.has(definition.stage) &&
          !isZeroUsage(result.usage)
        ) {
          throw new DailyStepError("INVALID_SOURCE_DATA", false);
        }
        if (
          (definition.stage === "publish" ||
            definition.stage === "cache_refresh") &&
          result.outcome !== "succeeded"
        ) {
          throw new DailyStepError("INVALID_SOURCE_DATA", false);
        }
        if (
          result.inputFingerprint !== expectedInputFingerprint ||
          !(await validateOutputReferenceWithin(
            definition,
            result.outputReference,
            Math.floor(
              Math.min(
                definition.retryPolicy.timeoutMs,
                deadlineAt - serverAdjustedMs(now()),
                new Date(lease.expiresAt).getTime() -
                  now().getTime() -
                  LEASE_COMPLETION_SAFETY_MS,
              ),
            ),
            options.abortSignal,
            { runId, runDate, stage: definition.stage },
          ))
        ) {
          throw new DailyStepError("INVALID_SOURCE_DATA", false);
        }
        const finishedAt = now();
        const deadlineExceededAfterSuccess =
          serverAdjustedMs(finishedAt) > deadlineAt;
        const budgetBlocked =
          (result.outcome === "withheld" &&
            result.reason === "BUDGET_EXCEEDED") ||
          usageExceeded(
            journalWithUpdate(journal, finishedAt.toISOString(), (draft) => {
              appendUsage(draft, result.usage);
            }),
          );

        if (budgetBlocked) {
          journal = journalWithUpdate(
            journal,
            finishedAt.toISOString(),
            (draft) => {
              appendUsage(draft, result.usage);
              const step = draft.run.steps.find(
                (candidate) => candidate.stage === definition.stage,
              );
              if (!step) return;
              step.status = "failed";
              step.inputFingerprint = result.inputFingerprint;
              step.outputReference = result.outputReference;
              step.finishedAt = finishedAt.toISOString();
              step.errorCode = "BUDGET_EXCEEDED";
              draft.run.currentStage = null;
              draft.attempts.push({
                stage: definition.stage,
                attemptNumber,
                status: "failed",
                inputFingerprint: result.inputFingerprint,
                outputReference: result.outputReference,
                startedAt: attemptStarted.toISOString(),
                finishedAt: finishedAt.toISOString(),
                errorCode: "BUDGET_EXCEEDED",
                retryable: false,
                retryDelayMs: 0,
              });
              skipAfter(draft, definition.stage, finishedAt.toISOString());
            },
          );
          return finishPending("blocked", now(), "BUDGET_EXCEEDED");
        }

        journal = journalWithUpdate(
          journal,
          finishedAt.toISOString(),
          (draft) => {
            appendUsage(draft, result.usage);
            const step = draft.run.steps.find(
              (candidate) => candidate.stage === definition.stage,
            );
            if (!step) return;
            step.status = "succeeded";
            step.inputFingerprint = result.inputFingerprint;
            step.outputReference = result.outputReference;
            step.finishedAt = finishedAt.toISOString();
            step.errorCode = null;
            draft.attempts.push({
              stage: definition.stage,
              attemptNumber,
              status: "succeeded",
              inputFingerprint: result.inputFingerprint,
              outputReference: result.outputReference,
              startedAt: attemptStarted.toISOString(),
              finishedAt: finishedAt.toISOString(),
              errorCode: null,
              retryable: false,
              retryDelayMs: 0,
            });
            if (result.outcome === "withheld") {
              skipAfter(draft, definition.stage, finishedAt.toISOString());
              draft.run.currentStage = null;
            } else if (deadlineExceededAfterSuccess) {
              skipAfter(draft, definition.stage, finishedAt.toISOString());
              draft.run.currentStage = null;
            } else {
              const currentIndex = stages.findIndex(
                (candidate) => candidate.stage === definition.stage,
              );
              draft.run.currentStage = stages[currentIndex + 1]?.stage ?? null;
            }
          },
        );
        emit(options.onEvent, {
          type: "step_succeeded",
          runId,
          runDate,
          stage: definition.stage,
          attemptNumber,
          errorCode: null,
        });
        if (result.outcome === "withheld") {
          return finishPending(
            "succeeded_without_publish",
            now(),
            result.reason,
          );
        }
        if (deadlineExceededAfterSuccess) {
          const published = journal.run.steps.some(
            (step) => step.stage === "publish" && step.status === "succeeded",
          );
          return finishPending(
            published ? "published_with_warning" : "failed",
            now(),
            "RUN_DEADLINE_EXCEEDED",
          );
        }
        await checkpoint(journal);
        break;
      } catch (caught) {
        if (caught instanceof DailyStageCommitUncertainError) {
          throw caught;
        }
        if (caught instanceof DailyRunStoreError) {
          throw caught;
        }
        let error = stepError(caught);
        if (definition.stage === "publish") {
          error = new DailyStepError("PUBLISH_TIMEOUT_AMBIGUOUS", false, {
            cause: error,
            ...(error.usage ? { usage: error.usage } : {}),
          });
        }
        const failedAt = now();
        const delayMs = nextDelay(definition.retryPolicy, attemptNumber);
        const deadlineAllowsRetry =
          serverAdjustedMs(failedAt) + delayMs < deadlineAt;
        const failureUsage =
          error.usage ??
          (MODEL_CAPABLE_STAGES.has(definition.stage)
            ? {
                modelCalls: 1,
                inputTokens: 0,
                outputTokens: 0,
                estimatedCostUsd: 0,
                hasUnpricedCalls: true,
              }
            : null);
        const budgetBlockedAfterFailure =
          failureUsage !== null &&
          usageExceeded(
            journalWithUpdate(journal, failedAt.toISOString(), (draft) => {
              appendUsage(draft, failureUsage);
            }),
          );
        const willRetry =
          error.retryable &&
          !budgetBlockedAfterFailure &&
          !options.abortSignal?.aborted &&
          definition.stage !== "publish" &&
          attemptNumber < definition.retryPolicy.maxAttempts &&
          deadlineAllowsRetry;
        journal = journalWithUpdate(
          journal,
          failedAt.toISOString(),
          (draft) => {
            if (failureUsage) {
              appendUsage(draft, failureUsage);
            }
            const step = draft.run.steps.find(
              (candidate) => candidate.stage === definition.stage,
            );
            if (!step) return;
            step.status = willRetry ? "failed_retryable" : "failed";
            step.finishedAt = failedAt.toISOString();
            step.errorCode = error.code;
            draft.attempts.push({
              stage: definition.stage,
              attemptNumber,
              status: "failed",
              inputFingerprint: step.inputFingerprint,
              outputReference: null,
              startedAt: attemptStarted.toISOString(),
              finishedAt: failedAt.toISOString(),
              errorCode: error.code,
              retryable: willRetry,
              retryDelayMs: willRetry ? delayMs : 0,
            });
            if (!willRetry) {
              skipAfter(draft, definition.stage, failedAt.toISOString());
              draft.run.currentStage = null;
            }
          },
        );
        emit(options.onEvent, {
          type: "step_failed",
          runId,
          runDate,
          stage: definition.stage,
          attemptNumber,
          errorCode: error.code,
        });
        if (budgetBlockedAfterFailure) {
          return finishPending("blocked", now(), "BUDGET_EXCEEDED");
        }
        if (!willRetry) {
          if (
            definition.stage === "cache_refresh" &&
            journal.run.steps.some(
              (step) => step.stage === "publish" && step.status === "succeeded",
            )
          ) {
            return finishPending(
              "published_with_warning",
              now(),
              error.code,
            );
          }
          const terminalStatus =
            error.code === "PUBLISH_TIMEOUT_AMBIGUOUS" ? "blocked" : "failed";
          return finishPending(terminalStatus, now(), error.code);
        }

        await checkpoint(journal);
        try {
          await sleep(
            delayMs,
            options.abortSignal ?? new AbortController().signal,
          );
        } catch (sleepFailure) {
          const interruptedAt = now();
          const interruption = options.abortSignal?.aborted
            ? new DailyStepError("RUN_ABORTED", false, {
                cause: sleepFailure,
              })
            : stepError(sleepFailure);
          const interruptedAttemptNumber = attemptNumber + 1;
          journal = journalWithUpdate(
            journal,
            interruptedAt.toISOString(),
            (draft) => {
              const step = draft.run.steps.find(
                (candidate) => candidate.stage === definition.stage,
              );
              if (!step) return;
              step.status = "failed";
              step.attemptNumber = interruptedAttemptNumber;
              step.startedAt = interruptedAt.toISOString();
              step.finishedAt = interruptedAt.toISOString();
              step.errorCode = interruption.code;
              draft.run.currentStage = null;
              draft.attempts.push({
                stage: definition.stage,
                attemptNumber: interruptedAttemptNumber,
                status: "failed",
                inputFingerprint: step.inputFingerprint,
                outputReference: null,
                startedAt: interruptedAt.toISOString(),
                finishedAt: interruptedAt.toISOString(),
                errorCode: interruption.code,
                retryable: false,
                retryDelayMs: 0,
              });
              skipAfter(draft, definition.stage, interruptedAt.toISOString());
            },
          );
          return finishPending("failed", now(), interruption.code);
        }
        attemptNumber += 1;
      }
    }

    if (attemptNumber > effectiveMaxAttempts) {
      return finish("failed", now(), "UNKNOWN_ERROR");
    }
  }

  return finish(
    stages.some((stage) => stage.stage === "publish")
      ? "succeeded"
      : "succeeded_without_publish",
    now(),
  );
}
