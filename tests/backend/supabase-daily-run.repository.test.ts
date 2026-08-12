import { describe, expect, it } from "vitest";

import type {
  DailyRunJournal,
  DailyRunLease,
  PipelineRunState,
} from "../../src/contracts";
import { DailyRunStoreError } from "../../src/pipeline/orchestrator/daily-run-store";
import {
  SupabaseDailyRunRepository,
  type SupabaseDailyRunRpcDataSource,
  type SupabaseDailyRunRpcName,
  type SupabaseDailyRunRpcResult,
} from "../../src/repositories/supabase-daily-run.repository";

const RUN_DATE = "2026-08-13";
const STARTED_AT = "2026-08-13T06:00:00+09:00";
const REQUESTED_EXPIRY = "2026-08-13T06:05:00+09:00";
const SERVER_ACQUIRED_AT = "2026-08-12T21:00:01.000Z";
const SERVER_EXPIRY = "2026-08-12T21:05:01.000Z";

function createRun(runId = "run-20260813"): PipelineRunState {
  return {
    runId,
    runDate: RUN_DATE,
    status: "running",
    pipelineVersion: "daily-pipeline-v1",
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
    expiresAt: REQUESTED_EXPIRY,
    ...overrides,
  };
}

function nextJournal(current = createJournal()): DailyRunJournal {
  return {
    ...structuredClone(current),
    revision: current.revision + 1,
    updatedAt: "2026-08-13T06:01:00+09:00",
  };
}

function terminalJournal(current = createJournal()): DailyRunJournal {
  const journal = nextJournal(current);
  journal.run.status = "failed";
  journal.run.currentStage = null;
  journal.run.steps[0] = {
    ...journal.run.steps[0],
    status: "failed",
    attemptNumber: 1,
    finishedAt: "2026-08-13T06:02:00+09:00",
    errorCode: "UNKNOWN_ERROR",
  };
  journal.attempts = [
    {
      stage: "collect",
      attemptNumber: 1,
      status: "failed",
      inputFingerprint: null,
      outputReference: null,
      startedAt: STARTED_AT,
      finishedAt: "2026-08-13T06:02:00+09:00",
      errorCode: "UNKNOWN_ERROR",
      retryable: false,
      retryDelayMs: 0,
    },
  ];
  journal.terminalReason = "UNKNOWN_ERROR";
  journal.finishedAt = "2026-08-13T06:02:00+09:00";
  journal.updatedAt = "2026-08-13T06:02:00+09:00";
  return journal;
}

type RpcCall = {
  functionName: SupabaseDailyRunRpcName;
  parameters: Readonly<Record<string, unknown>>;
};

class FakeRpcDataSource implements SupabaseDailyRunRpcDataSource {
  readonly calls: RpcCall[] = [];

  constructor(
    private readonly handler: (
      functionName: SupabaseDailyRunRpcName,
      parameters: Readonly<Record<string, unknown>>,
    ) => SupabaseDailyRunRpcResult | Promise<SupabaseDailyRunRpcResult>,
  ) {}

  async rpc(
    functionName: SupabaseDailyRunRpcName,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<SupabaseDailyRunRpcResult> {
    this.calls.push({ functionName, parameters });
    return this.handler(functionName, parameters);
  }
}

function successful(data: unknown): SupabaseDailyRunRpcResult {
  return { data, error: null };
}

async function expectStoreError(
  operation: Promise<unknown>,
  code: DailyRunStoreError["code"],
): Promise<DailyRunStoreError> {
  try {
    await operation;
    throw new Error("저장소 오류가 발생해야 합니다.");
  } catch (error) {
    expect(error).toBeInstanceOf(DailyRunStoreError);
    expect((error as DailyRunStoreError).code).toBe(code);
    return error as DailyRunStoreError;
  }
}

function freshAcquireResponse() {
  return {
    status: "acquired" as const,
    lease: createLease({
      acquiredAt: SERVER_ACQUIRED_AT,
      expiresAt: SERVER_EXPIRY,
    }),
    journal: createJournal(),
    recoveredExpiredLease: false,
  };
}

describe("SupabaseDailyRunRepository", () => {
  it("acquire는 snake_case 인자를 보내고 DB 서버가 반환한 임대 시각을 사용한다", async () => {
    const dataSource = new FakeRpcDataSource(() =>
      successful(freshAcquireResponse()),
    );
    const repository = new SupabaseDailyRunRepository(dataSource);

    const result = await repository.acquireLease({
      lease: createLease(),
      initialJournal: createJournal(),
      now: STARTED_AT,
    });

    expect(dataSource.calls).toEqual([
      {
        functionName: "acquire_daily_run",
        parameters: {
          p_run_date: RUN_DATE,
          p_requested_lease: createLease(),
          p_initial_journal: createJournal(),
          p_requested_now: STARTED_AT,
        },
      },
    ]);
    expect(result).toMatchObject({
      status: "acquired",
      lease: {
        acquiredAt: SERVER_ACQUIRED_AT,
        expiresAt: SERVER_EXPIRY,
      },
    });
  });

  it("busy 결과의 실행 날짜를 검증한 뒤 내부 wire 필드를 제거한다", async () => {
    const matching = new SupabaseDailyRunRepository(
      new FakeRpcDataSource(() =>
        successful({
          status: "busy",
          runDate: RUN_DATE,
          runId: "existing-run",
          ownerId: "other-worker",
          expiresAt: SERVER_EXPIRY,
        }),
      ),
    );

    await expect(
      matching.acquireLease({
        lease: createLease(),
        initialJournal: createJournal(),
        now: STARTED_AT,
      }),
    ).resolves.toEqual({
      status: "busy",
      runId: "existing-run",
      ownerId: "other-worker",
      expiresAt: SERVER_EXPIRY,
    });

    const wrongDate = new SupabaseDailyRunRepository(
      new FakeRpcDataSource(() =>
        successful({
          status: "busy",
          runDate: "2026-08-12",
          runId: "existing-run",
          ownerId: "other-worker",
          expiresAt: SERVER_EXPIRY,
        }),
      ),
    );
    await expectStoreError(
      wrongDate.acquireLease({
        lease: createLease(),
        initialJournal: createJournal(),
        now: STARTED_AT,
      }),
      "RUN_ID_MISMATCH",
    );
  });

  it("만료 임대 회수에서는 기존 runId와 증가한 fence만 허용한다", async () => {
    const recoveredJournal = createJournal("existing-run");
    const repository = new SupabaseDailyRunRepository(
      new FakeRpcDataSource(() =>
        successful({
          status: "acquired",
          lease: createLease({
            runId: "existing-run",
            fence: 2,
            acquiredAt: SERVER_ACQUIRED_AT,
            expiresAt: SERVER_EXPIRY,
          }),
          journal: recoveredJournal,
          recoveredExpiredLease: true,
        }),
      ),
    );

    await expect(
      repository.acquireLease({
        lease: createLease(),
        initialJournal: createJournal(),
        now: STARTED_AT,
      }),
    ).resolves.toMatchObject({
      status: "acquired",
      recoveredExpiredLease: true,
      lease: { runId: "existing-run", fence: 2 },
      journal: { run: { runId: "existing-run" } },
    });
  });

  it("acquire 응답의 토큰·fence·runId 불일치를 fail-closed로 거부한다", async () => {
    const cases: Array<{
      mutate: (value: ReturnType<typeof freshAcquireResponse>) => void;
      code: DailyRunStoreError["code"];
    }> = [
      {
        mutate: (value) => {
          value.lease.leaseToken = "other-token";
        },
        code: "LEASE_TOKEN_MISMATCH",
      },
      {
        mutate: (value) => {
          value.lease.fence = 2;
        },
        code: "RUN_ID_MISMATCH",
      },
      {
        mutate: (value) => {
          value.journal.run.runId = "other-run";
        },
        code: "RUN_ID_MISMATCH",
      },
    ];

    for (const testCase of cases) {
      const response = freshAcquireResponse();
      testCase.mutate(response);
      const repository = new SupabaseDailyRunRepository(
        new FakeRpcDataSource(() => successful(response)),
      );
      await expectStoreError(
        repository.acquireLease({
          lease: createLease(),
          initialJournal: createJournal(),
          now: STARTED_AT,
        }),
        testCase.code,
      );
    }
  });

  it("terminal 결과는 종료 저널과 요청 날짜가 모두 일치해야 한다", async () => {
    const repository = new SupabaseDailyRunRepository(
      new FakeRpcDataSource(() =>
        successful({ status: "terminal", journal: terminalJournal() }),
      ),
    );
    await expect(
      repository.acquireLease({
        lease: createLease(),
        initialJournal: createJournal(),
        now: STARTED_AT,
      }),
    ).resolves.toMatchObject({
      status: "terminal",
      journal: { run: { status: "failed" } },
    });

    const wrong = terminalJournal();
    wrong.run.runDate = "2026-08-12";
    const wrongDateRepository = new SupabaseDailyRunRepository(
      new FakeRpcDataSource(() =>
        successful({ status: "terminal", journal: wrong }),
      ),
    );
    await expectStoreError(
      wrongDateRepository.acquireLease({
        lease: createLease(),
        initialJournal: createJournal(),
        now: STARTED_AT,
      }),
      "RUN_ID_MISMATCH",
    );
  });

  it("checkpoint는 CAS 인자와 요청 시각을 전달하되 반환된 서버 시각을 보존한다", async () => {
    const journal = nextJournal();
    const serverLease = createLease({
      acquiredAt: "2026-08-12T21:01:01.000Z",
      expiresAt: "2026-08-12T21:06:01.000Z",
    });
    const dataSource = new FakeRpcDataSource(() =>
      successful({ journal, lease: serverLease }),
    );
    const repository = new SupabaseDailyRunRepository(dataSource);

    const result = await repository.checkpoint({
      leaseToken: "lease-1",
      fence: 1,
      journal,
      renewedAt: "2026-08-13T06:01:00+09:00",
      renewedExpiresAt: "2026-08-13T06:06:00+09:00",
    });

    expect(dataSource.calls[0]).toEqual({
      functionName: "checkpoint_daily_run",
      parameters: {
        p_run_date: RUN_DATE,
        p_run_id: "run-20260813",
        p_lease_token: "lease-1",
        p_fence: 1,
        p_expected_revision: 0,
        p_journal: journal,
        p_requested_renewed_at: "2026-08-13T06:01:00+09:00",
        p_requested_expires_at: "2026-08-13T06:06:00+09:00",
      },
    });
    expect(result.lease).toEqual(serverLease);
  });

  it("checkpoint 응답의 runId·토큰·fence·revision 불일치를 구분한다", async () => {
    const requested = nextJournal();
    const cases: Array<{
      journal: DailyRunJournal;
      lease: DailyRunLease;
      code: DailyRunStoreError["code"];
    }> = [
      {
        journal: { ...structuredClone(requested), revision: 2 },
        lease: createLease(),
        code: "STALE_JOURNAL_REVISION",
      },
      {
        journal: requested,
        lease: createLease({ leaseToken: "stale-token" }),
        code: "LEASE_TOKEN_MISMATCH",
      },
      {
        journal: requested,
        lease: createLease({ fence: 2 }),
        code: "FENCE_MISMATCH",
      },
      {
        journal: requested,
        lease: createLease({ runId: "other-run" }),
        code: "RUN_ID_MISMATCH",
      },
    ];

    for (const testCase of cases) {
      const repository = new SupabaseDailyRunRepository(
        new FakeRpcDataSource(() =>
          successful({
            journal: testCase.journal,
            lease: testCase.lease,
          }),
        ),
      );
      await expectStoreError(
        repository.checkpoint({
          leaseToken: "lease-1",
          fence: 1,
          journal: requested,
          renewedAt: "2026-08-13T06:01:00+09:00",
          renewedExpiresAt: "2026-08-13T06:06:00+09:00",
        }),
        testCase.code,
      );
    }
  });

  it("finish는 expected revision을 전달하고 동일한 종료 저널만 반환한다", async () => {
    const journal = terminalJournal();
    const dataSource = new FakeRpcDataSource(() => successful(journal));
    const repository = new SupabaseDailyRunRepository(dataSource);

    await expect(
      repository.finish({
        leaseToken: "lease-1",
        fence: 1,
        journal,
        now: "2026-08-13T06:02:00+09:00",
      }),
    ).resolves.toEqual(journal);
    expect(dataSource.calls[0]).toEqual({
      functionName: "finish_daily_run",
      parameters: {
        p_run_date: RUN_DATE,
        p_run_id: "run-20260813",
        p_lease_token: "lease-1",
        p_fence: 1,
        p_expected_revision: 0,
        p_journal: journal,
        p_requested_now: "2026-08-13T06:02:00+09:00",
      },
    });
  });

  it("DB가 보고한 stale token/fence/revision/expired lease 오류를 안정 코드로 보존한다", async () => {
    for (const code of [
      "LEASE_TOKEN_MISMATCH",
      "FENCE_MISMATCH",
      "STALE_JOURNAL_REVISION",
      "LEASE_EXPIRED",
    ] as const) {
      const repository = new SupabaseDailyRunRepository(
        new FakeRpcDataSource(() => ({
          data: null,
          error: { code: "P0001", message: code },
        })),
      );
      await expectStoreError(
        repository.finish({
          leaseToken: "lease-1",
          fence: 1,
          journal: terminalJournal(),
          now: "2026-08-13T06:02:00+09:00",
        }),
        code,
      );
    }
  });

  it("malformed 응답·네트워크 예외·알 수 없는 RPC 오류를 payload 없이 STORE_UNAVAILABLE로 바꾼다", async () => {
    const secret = "sb_secret_must_not_escape";
    const repositories = [
      new SupabaseDailyRunRepository(
        new FakeRpcDataSource(() => successful({ status: "acquired" })),
      ),
      new SupabaseDailyRunRepository(
        new FakeRpcDataSource(() => {
          throw new Error(secret);
        }),
      ),
      new SupabaseDailyRunRepository(
        new FakeRpcDataSource(() => ({
          data: { secret },
          error: { code: "PGRST500", message: secret },
        })),
      ),
    ];

    for (const repository of repositories) {
      const error = await expectStoreError(
        repository.acquireLease({
          lease: createLease(),
          initialJournal: createJournal(),
          now: STARTED_AT,
        }),
        "STORE_UNAVAILABLE",
      );
      expect(error.message).not.toContain(secret);
      expect(error.cause).toBeUndefined();
    }
  });

  it("get은 null과 동일 날짜 저널만 허용한다", async () => {
    const empty = new SupabaseDailyRunRepository(
      new FakeRpcDataSource(() => successful(null)),
    );
    await expect(empty.get(RUN_DATE)).resolves.toBeNull();

    const matchingDataSource = new FakeRpcDataSource(() =>
      successful(createJournal()),
    );
    const matching = new SupabaseDailyRunRepository(matchingDataSource);
    await expect(matching.get(RUN_DATE)).resolves.toEqual(createJournal());
    expect(matchingDataSource.calls[0]).toEqual({
      functionName: "get_daily_run",
      parameters: { p_run_date: RUN_DATE },
    });

    const wrong = createJournal();
    wrong.run.runDate = "2026-08-12";
    const wrongDate = new SupabaseDailyRunRepository(
      new FakeRpcDataSource(() => successful(wrong)),
    );
    await expectStoreError(wrongDate.get(RUN_DATE), "RUN_ID_MISMATCH");
  });
});
