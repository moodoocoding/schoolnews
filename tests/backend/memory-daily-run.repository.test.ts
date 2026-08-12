import { describe, expect, it } from "vitest";

import type {
  DailyRunJournal,
  DailyRunLease,
  PipelineRunState,
} from "../../src/contracts";
import {
  MemoryDailyRunRepository,
} from "../../src/repositories/memory-daily-run.repository";
import { DailyRunStoreError } from "../../src/pipeline/orchestrator/daily-run-store";

const RUN_DATE = "2026-08-13";
const STARTED_AT = "2026-08-13T06:00:00+09:00";
const FIRST_EXPIRY = "2026-08-13T06:05:00+09:00";

function createRun(runId = "run-20260813"): PipelineRunState {
  return {
    runId,
    runDate: RUN_DATE,
    status: "running",
    pipelineVersion: "pipeline-v1",
    currentStage: "collect",
    steps: [
      {
        stage: "collect",
        status: "running",
        attemptNumber: 0,
        inputFingerprint: null,
        outputReference: null,
        startedAt: STARTED_AT,
        finishedAt: null,
        errorCode: null,
      },
    ],
    limits: {
      maxModelCalls: 4,
      maxInputTokens: 12_000,
      maxOutputTokens: 4_000,
      maxEstimatedCostUsd: 1,
      maxRunSeconds: 900,
    },
    usage: {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      hasUnpricedCalls: false,
    },
  };
}

function createJournal(runId = "run-20260813"): DailyRunJournal {
  return {
    schemaVersion: "daily-run-v1",
    revision: 0,
    run: createRun(runId),
    attempts: [],
    terminalReason: null,
    startedAt: STARTED_AT,
    finishedAt: null,
    updatedAt: STARTED_AT,
  };
}

function createLease(
  overrides: Partial<DailyRunLease> = {},
): DailyRunLease {
  return {
    runDate: RUN_DATE,
    runId: "run-20260813",
    ownerId: "worker-1",
    leaseToken: "lease-1",
    fence: 1,
    acquiredAt: STARTED_AT,
    expiresAt: FIRST_EXPIRY,
    ...overrides,
  };
}

function nextJournal(
  current: DailyRunJournal,
  updatedAt = "2026-08-13T06:01:00+09:00",
): DailyRunJournal {
  return {
    ...structuredClone(current),
    revision: current.revision + 1,
    updatedAt,
  };
}

function failedTerminalJournal(
  current: DailyRunJournal,
  revision = current.revision + 1,
): DailyRunJournal {
  const terminalJournal = {
    ...structuredClone(current),
    revision,
    terminalReason: "UNKNOWN_ERROR" as const,
    finishedAt: "2026-08-13T06:02:00+09:00",
    updatedAt: "2026-08-13T06:02:00+09:00",
  };
  terminalJournal.run.status = "failed";
  terminalJournal.run.currentStage = null;
  terminalJournal.run.steps[0] = {
    ...terminalJournal.run.steps[0],
    status: "failed",
    attemptNumber: 1,
    finishedAt: "2026-08-13T06:02:00+09:00",
    errorCode: "UNKNOWN_ERROR",
  };
  return terminalJournal;
}

async function expectStoreError(
  operation: Promise<unknown>,
  code: DailyRunStoreError["code"],
): Promise<void> {
  try {
    await operation;
    throw new Error("저장소 오류가 발생해야 합니다.");
  } catch (error) {
    expect(error).toBeInstanceOf(DailyRunStoreError);
    expect((error as DailyRunStoreError).code).toBe(code);
  }
}

describe("MemoryDailyRunRepository", () => {
  it("같은 날짜의 동시 acquire에서 정확히 한 작업자만 임대를 얻는다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();

    const results = await Promise.all([
      repository.acquireLease({
        lease: createLease(),
        initialJournal: journal,
        now: STARTED_AT,
      }),
      repository.acquireLease({
        lease: createLease({
          ownerId: "worker-2",
          leaseToken: "lease-2",
        }),
        initialJournal: journal,
        now: STARTED_AT,
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "acquired",
      "busy",
    ]);
    const busy = results.find((result) => result.status === "busy");
    expect(busy).toMatchObject({
      runId: "run-20260813",
      ownerId: "worker-1",
      expiresAt: FIRST_EXPIRY,
    });
  });

  it("만료된 임대는 새 토큰으로 기존 비종료 저널을 회수한다", async () => {
    const repository = new MemoryDailyRunRepository();
    await repository.acquireLease({
      lease: createLease(),
      initialJournal: createJournal(),
      now: STARTED_AT,
    });

    const recovered = await repository.acquireLease({
      lease: createLease({
        runId: "replacement-run",
        ownerId: "worker-2",
        leaseToken: "lease-2",
        fence: 2,
        acquiredAt: "2026-08-13T06:06:00+09:00",
        expiresAt: "2026-08-13T06:11:00+09:00",
      }),
      initialJournal: createJournal("replacement-run"),
      now: "2026-08-13T06:06:00+09:00",
    });

    expect(recovered).toMatchObject({
      status: "acquired",
      recoveredExpiredLease: true,
      lease: {
        runId: "run-20260813",
        ownerId: "worker-2",
        leaseToken: "lease-2",
      },
      journal: {
        revision: 0,
        run: { runId: "run-20260813" },
      },
    });
  });

  it("회수 뒤 이전 fence를 사용하는 작업자를 거부한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();
    await repository.acquireLease({
      lease: createLease(),
      initialJournal: journal,
      now: STARTED_AT,
    });
    const recovered = await repository.acquireLease({
      lease: createLease({
        ownerId: "worker-2",
        leaseToken: "lease-2",
        acquiredAt: "2026-08-13T06:06:00+09:00",
        expiresAt: "2026-08-13T06:11:00+09:00",
      }),
      initialJournal: journal,
      now: "2026-08-13T06:06:00+09:00",
    });
    expect(recovered).toMatchObject({
      status: "acquired",
      lease: { fence: 2 },
    });

    await expectStoreError(
      repository.checkpoint({
        leaseToken: "lease-2",
        fence: 1,
        journal: nextJournal(journal, "2026-08-13T06:07:00+09:00"),
        renewedAt: "2026-08-13T06:07:00+09:00",
        renewedExpiresAt: "2026-08-13T06:12:00+09:00",
      }),
      "FENCE_MISMATCH",
    );
  });

  it("checkpoint에서 stale 토큰과 stale revision을 fail-closed로 거부한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();
    await repository.acquireLease({
      lease: createLease(),
      initialJournal: journal,
      now: STARTED_AT,
    });

    await expectStoreError(
      repository.checkpoint({
        leaseToken: "stale-token",
        fence: 1,
        journal: nextJournal(journal),
        renewedAt: "2026-08-13T06:01:00+09:00",
        renewedExpiresAt: "2026-08-13T06:06:00+09:00",
      }),
      "LEASE_TOKEN_MISMATCH",
    );
    await expectStoreError(
      repository.checkpoint({
        leaseToken: "lease-1",
        fence: 1,
        journal,
        renewedAt: "2026-08-13T06:01:00+09:00",
        renewedExpiresAt: "2026-08-13T06:06:00+09:00",
      }),
      "STALE_JOURNAL_REVISION",
    );
  });

  it("초기·checkpoint 경로로 종료 저널을 저장하지 못하게 한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();
    await expectStoreError(
      repository.acquireLease({
        lease: createLease(),
        initialJournal: failedTerminalJournal(journal, 0),
        now: STARTED_AT,
      }),
      "ACTIVE_JOURNAL_REQUIRED",
    );

    await repository.acquireLease({
      lease: createLease(),
      initialJournal: journal,
      now: STARTED_AT,
    });
    await expectStoreError(
      repository.checkpoint({
        leaseToken: "lease-1",
        fence: 1,
        journal: failedTerminalJournal(journal),
        renewedAt: "2026-08-13T06:01:00+09:00",
        renewedExpiresAt: "2026-08-13T06:06:00+09:00",
      }),
      "ACTIVE_JOURNAL_REQUIRED",
    );
  });

  it("pipeline 버전·한도·단계 목록과 저널 시각의 변경을 거부한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();
    await repository.acquireLease({
      lease: createLease(),
      initialJournal: journal,
      now: STARTED_AT,
    });

    for (const mutate of [
      (next: DailyRunJournal) => {
        next.run.pipelineVersion = "pipeline-v2";
      },
      (next: DailyRunJournal) => {
        next.run.limits.maxModelCalls += 1;
      },
      (next: DailyRunJournal) => {
        next.run.steps.push({
          stage: "validate",
          status: "pending",
          attemptNumber: 0,
          inputFingerprint: null,
          outputReference: null,
          startedAt: null,
          finishedAt: null,
          errorCode: null,
        });
      },
      (next: DailyRunJournal) => {
        next.updatedAt = "2026-08-13T05:59:00+09:00";
      },
    ]) {
      const changed = nextJournal(journal);
      mutate(changed);
      await expectStoreError(
        repository.checkpoint({
          leaseToken: "lease-1",
          fence: 1,
          journal: changed,
          renewedAt: "2026-08-13T06:01:00+09:00",
          renewedExpiresAt: "2026-08-13T06:06:00+09:00",
        }),
        "JOURNAL_REGRESSION",
      );
    }
  });

  it("만료된 현재 임대의 checkpoint를 거부한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();
    await repository.acquireLease({
      lease: createLease(),
      initialJournal: journal,
      now: STARTED_AT,
    });

    await expectStoreError(
      repository.checkpoint({
        leaseToken: "lease-1",
        fence: 1,
        journal: nextJournal(journal, "2026-08-13T06:05:00+09:00"),
        renewedAt: "2026-08-13T06:05:00+09:00",
        renewedExpiresAt: "2026-08-13T06:10:00+09:00",
      }),
      "LEASE_EXPIRED",
    );
  });

  it("checkpoint는 revision을 하나만 올리고 같은 실행·소유자·토큰으로 갱신한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();
    await repository.acquireLease({
      lease: createLease(),
      initialJournal: journal,
      now: STARTED_AT,
    });

    const checkpointed = await repository.checkpoint({
      leaseToken: "lease-1",
      fence: 1,
      journal: nextJournal(journal),
      renewedAt: "2026-08-13T06:01:00+09:00",
      renewedExpiresAt: "2026-08-13T06:06:00+09:00",
    });

    expect(checkpointed.journal.revision).toBe(1);
    expect(checkpointed.lease).toMatchObject({
      runId: "run-20260813",
      ownerId: "worker-1",
      leaseToken: "lease-1",
      fence: 1,
      acquiredAt: "2026-08-13T06:01:00+09:00",
      expiresAt: "2026-08-13T06:06:00+09:00",
    });
  });

  it("usage 감소, attempt 수정, 성공 단계 변경을 저널 회귀로 거부한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();
    await repository.acquireLease({
      lease: createLease(),
      initialJournal: journal,
      now: STARTED_AT,
    });

    const firstCheckpoint = nextJournal(journal);
    firstCheckpoint.run.currentStage = null;
    firstCheckpoint.run.steps = [
      {
        ...firstCheckpoint.run.steps[0],
        status: "succeeded",
        attemptNumber: 1,
        outputReference: "collected-1",
        finishedAt: "2026-08-13T06:00:30+09:00",
      },
    ];
    firstCheckpoint.run.usage = {
      modelCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      estimatedCostUsd: 0.1,
      hasUnpricedCalls: true,
    };
    firstCheckpoint.attempts = [
      {
        stage: "collect",
        attemptNumber: 1,
        status: "succeeded",
        inputFingerprint: null,
        outputReference: "collected-1",
        startedAt: STARTED_AT,
        finishedAt: "2026-08-13T06:00:30+09:00",
        errorCode: null,
        retryable: false,
        retryDelayMs: 0,
      },
    ];
    const stored = await repository.checkpoint({
      leaseToken: "lease-1",
      fence: 1,
      journal: firstCheckpoint,
      renewedAt: "2026-08-13T06:01:00+09:00",
      renewedExpiresAt: "2026-08-13T06:06:00+09:00",
    });

    const usageRegression = nextJournal(
      stored.journal,
      "2026-08-13T06:02:00+09:00",
    );
    usageRegression.run.usage.modelCalls = 0;
    usageRegression.run.usage.hasUnpricedCalls = false;
    await expectStoreError(
      repository.checkpoint({
        leaseToken: "lease-1",
        fence: 1,
        journal: usageRegression,
        renewedAt: "2026-08-13T06:02:00+09:00",
        renewedExpiresAt: "2026-08-13T06:07:00+09:00",
      }),
      "JOURNAL_REGRESSION",
    );

    const attemptMutation = nextJournal(
      stored.journal,
      "2026-08-13T06:02:00+09:00",
    );
    attemptMutation.attempts[0].outputReference = "rewritten";
    await expectStoreError(
      repository.checkpoint({
        leaseToken: "lease-1",
        fence: 1,
        journal: attemptMutation,
        renewedAt: "2026-08-13T06:02:00+09:00",
        renewedExpiresAt: "2026-08-13T06:07:00+09:00",
      }),
      "JOURNAL_REGRESSION",
    );

    const succeededStepMutation = nextJournal(
      stored.journal,
      "2026-08-13T06:02:00+09:00",
    );
    succeededStepMutation.run.steps[0].outputReference = "rewritten";
    await expectStoreError(
      repository.checkpoint({
        leaseToken: "lease-1",
        fence: 1,
        journal: succeededStepMutation,
        renewedAt: "2026-08-13T06:02:00+09:00",
        renewedExpiresAt: "2026-08-13T06:07:00+09:00",
      }),
      "JOURNAL_REGRESSION",
    );
  });

  it("종료 후 같은 날짜 acquire는 terminal 저널만 반환한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();
    await repository.acquireLease({
      lease: createLease(),
      initialJournal: journal,
      now: STARTED_AT,
    });
    const terminalJournal = nextJournal(
      journal,
      "2026-08-13T06:02:00+09:00",
    );
    terminalJournal.run.status = "succeeded_without_publish";
    terminalJournal.run.currentStage = null;
    terminalJournal.run.steps[0] = {
      ...terminalJournal.run.steps[0],
      status: "succeeded",
      attemptNumber: 1,
      finishedAt: "2026-08-13T06:02:00+09:00",
    };
    terminalJournal.finishedAt = "2026-08-13T06:02:00+09:00";

    await repository.finish({
      leaseToken: "lease-1",
      fence: 1,
      journal: terminalJournal,
      now: "2026-08-13T06:02:00+09:00",
    });
    const rerun = await repository.acquireLease({
      lease: createLease({
        runId: "replacement-run",
        ownerId: "worker-2",
        leaseToken: "lease-2",
        fence: 2,
        acquiredAt: "2026-08-13T06:03:00+09:00",
        expiresAt: "2026-08-13T06:08:00+09:00",
      }),
      initialJournal: createJournal("replacement-run"),
      now: "2026-08-13T06:03:00+09:00",
    });

    expect(rerun).toMatchObject({
      status: "terminal",
      journal: {
        revision: 1,
        run: { runId: "run-20260813", status: "succeeded_without_publish" },
      },
    });
  });

  it("finish에서 stale token·fence·revision과 비종료 저널을 거부한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();
    await repository.acquireLease({
      lease: createLease(),
      initialJournal: journal,
      now: STARTED_AT,
    });

    await expectStoreError(
      repository.finish({
        leaseToken: "stale-token",
        fence: 1,
        journal: failedTerminalJournal(journal),
        now: "2026-08-13T06:02:00+09:00",
      }),
      "LEASE_TOKEN_MISMATCH",
    );
    await expectStoreError(
      repository.finish({
        leaseToken: "lease-1",
        fence: 2,
        journal: failedTerminalJournal(journal),
        now: "2026-08-13T06:02:00+09:00",
      }),
      "FENCE_MISMATCH",
    );
    await expectStoreError(
      repository.finish({
        leaseToken: "lease-1",
        fence: 1,
        journal: failedTerminalJournal(journal, 2),
        now: "2026-08-13T06:02:00+09:00",
      }),
      "STALE_JOURNAL_REVISION",
    );
    await expectStoreError(
      repository.finish({
        leaseToken: "lease-1",
        fence: 1,
        journal: nextJournal(journal),
        now: "2026-08-13T06:02:00+09:00",
      }),
      "TERMINAL_JOURNAL_REQUIRED",
    );
  });

  it("만료된 실행권으로 종료 상태를 선점하지 못하게 한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const journal = createJournal();
    await repository.acquireLease({
      lease: createLease(),
      initialJournal: journal,
      now: STARTED_AT,
    });

    await expectStoreError(
      repository.finish({
        leaseToken: "lease-1",
        fence: 1,
        journal: failedTerminalJournal(journal),
        now: "2026-08-13T06:05:00+09:00",
      }),
      "LEASE_EXPIRED",
    );
  });

  it("입력과 acquire·checkpoint·finish·get 결과를 방어 복사한다", async () => {
    const repository = new MemoryDailyRunRepository();
    const inputJournal = createJournal();
    const inputLease = createLease();
    const acquired = await repository.acquireLease({
      lease: inputLease,
      initialJournal: inputJournal,
      now: STARTED_AT,
    });
    inputJournal.run.runId = "mutated-input";
    inputLease.ownerId = "mutated-input";
    if (acquired.status !== "acquired") {
      throw new Error("첫 임대를 얻어야 합니다.");
    }
    acquired.journal.run.runId = "mutated-result";
    acquired.lease.ownerId = "mutated-result";

    const storedAfterAcquire = await repository.get(RUN_DATE);
    expect(storedAfterAcquire?.run.runId).toBe("run-20260813");
    const checkpointed = await repository.checkpoint({
      leaseToken: "lease-1",
      fence: 1,
      journal: nextJournal(storedAfterAcquire!),
      renewedAt: "2026-08-13T06:01:00+09:00",
      renewedExpiresAt: "2026-08-13T06:06:00+09:00",
    });
    checkpointed.journal.run.runId = "mutated-checkpoint";
    checkpointed.lease.ownerId = "mutated-checkpoint";
    const storedAfterCheckpoint = await repository.get(RUN_DATE);
    expect(storedAfterCheckpoint?.run.runId).toBe("run-20260813");

    const terminalJournal = failedTerminalJournal(storedAfterCheckpoint!);
    const finished = await repository.finish({
      leaseToken: "lease-1",
      fence: 1,
      journal: terminalJournal,
      now: "2026-08-13T06:02:00+09:00",
    });
    finished.run.runId = "mutated-finish";
    const firstGet = await repository.get(RUN_DATE);
    firstGet!.run.runId = "mutated-get";
    const secondGet = await repository.get(RUN_DATE);
    expect(secondGet?.run.runId).toBe("run-20260813");
  });
});
