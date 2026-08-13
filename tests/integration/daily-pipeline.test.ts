import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  DailyRunJournal,
  DailyRunLease,
  PipelineStage,
} from "../../src/contracts";
import {
  DailyStepError,
  runDailyPipeline,
  type DailyPipelineLimits,
  type DailyRunAcquireResult,
  type DailyRunStore,
  type DailyStageDefinition,
} from "../../src/pipeline/orchestrator";
import { MemoryDailyRunRepository } from "../../src/repositories";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const limits: DailyPipelineLimits = {
  maxModelCalls: 4,
  maxInputTokens: 10_000,
  maxOutputTokens: 4_000,
  maxEstimatedCostUsd: 1,
  maxRunSeconds: 900,
};

class TestDailyRunStore implements DailyRunStore {
  journal: DailyRunJournal | null = null;
  lease: DailyRunLease | null = null;

  async acquireLease(input: {
    lease: DailyRunLease;
    initialJournal: DailyRunJournal;
    now: string;
  }): Promise<DailyRunAcquireResult> {
    if (this.journal?.finishedAt) {
      return { status: "terminal", journal: structuredClone(this.journal) };
    }
    if (this.lease && new Date(input.now) < new Date(this.lease.expiresAt)) {
      return {
        status: "busy",
        runId: this.lease.runId,
        ownerId: this.lease.ownerId,
        expiresAt: this.lease.expiresAt,
      };
    }
    const recoveredExpiredLease = this.journal !== null;
    this.lease = {
      ...structuredClone(input.lease),
      runId: this.journal?.run.runId ?? input.lease.runId,
      fence: (this.lease?.fence ?? 0) + 1,
    };
    this.journal ??= structuredClone(input.initialJournal);
    return {
      status: "acquired",
      lease: structuredClone(this.lease),
      journal: structuredClone(this.journal),
      recoveredExpiredLease,
    };
  }

  async checkpoint(input: {
    leaseToken: string;
    fence: number;
    journal: DailyRunJournal;
    renewedAt: string;
    renewedExpiresAt: string;
  }) {
    if (
      !this.lease ||
      input.leaseToken !== this.lease.leaseToken ||
      input.fence !== this.lease.fence
    ) {
      throw new Error("stale lease");
    }
    this.journal = structuredClone(input.journal);
    this.lease = {
      ...this.lease,
      acquiredAt: input.renewedAt,
      expiresAt: input.renewedExpiresAt,
    };
    return {
      journal: structuredClone(this.journal),
      lease: structuredClone(this.lease),
    };
  }

  async finish(input: {
    leaseToken: string;
    fence: number;
    journal: DailyRunJournal;
    now: string;
  }): Promise<DailyRunJournal> {
    if (
      !this.lease ||
      input.leaseToken !== this.lease.leaseToken ||
      input.fence !== this.lease.fence ||
      new Date(input.now) >= new Date(this.lease.expiresAt)
    ) {
      throw new Error("stale lease");
    }
    this.journal = structuredClone(input.journal);
    this.lease = null;
    return structuredClone(this.journal);
  }

  async get(): Promise<DailyRunJournal | null> {
    return this.journal ? structuredClone(this.journal) : null;
  }
}

function stage(
  name: PipelineStage,
  execute: DailyStageDefinition["execute"] = async () => ({
    outcome: "succeeded",
    inputFingerprint: hash(name),
    outputReference: `${name}-output`,
    usage: {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      hasUnpricedCalls: false,
    },
  }),
  maxAttempts = name === "publish" ? 1 : 3,
): DailyStageDefinition {
  return {
    stage: name,
    inputFingerprint: hash(name),
    retryPolicy: {
      maxAttempts,
      initialDelayMs: 100,
      multiplier: 2,
      maxDelayMs: 1_000,
      timeoutMs: 10_000,
    },
    validateOutputReference: (reference) =>
      reference === `${name}-output`,
    execute,
  };
}

function clock(start = "2026-08-12T15:00:00.000Z", stepMs = 10) {
  let time = new Date(start).getTime();
  return () => {
    const current = new Date(time);
    time += stepMs;
    return current;
  };
}

describe("M4 일일 파이프라인", () => {
  it("UTC 자정이 아닌 Asia/Seoul 경계로 실행 날짜를 정한다", async () => {
    const before = await runDailyPipeline({
      store: new TestDailyRunStore(),
      stages: [stage("collect")],
      limits,
      now: clock("2026-08-12T14:59:59.000Z"),
      createLeaseToken: () => "lease-before",
    });
    const after = await runDailyPipeline({
      store: new TestDailyRunStore(),
      stages: [stage("collect")],
      limits,
      now: clock("2026-08-12T15:00:00.000Z"),
      createLeaseToken: () => "lease-after",
    });

    expect(before.status === "executed" && before.journal.run.runDate).toBe(
      "2026-08-12",
    );
    expect(after.status === "executed" && after.journal.run.runDate).toBe(
      "2026-08-13",
    );
  });

  it("재시도 가능한 실패에 100ms, 200ms 백오프 후 성공한다", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await runDailyPipeline({
      store: new TestDailyRunStore(),
      stages: [
        stage("collect", async () => {
          calls += 1;
          if (calls < 3) {
            throw new DailyStepError("SOURCE_UNAVAILABLE", true);
          }
          return {
            outcome: "succeeded",
            inputFingerprint: hash("collect"),
            outputReference: "collect-output",
            usage: {
              modelCalls: 0,
              inputTokens: 0,
              outputTokens: 0,
              estimatedCostUsd: 0,
              hasUnpricedCalls: false,
            },
          };
        }),
      ],
      limits,
      runDate: "2026-08-13",
      now: clock(),
      createLeaseToken: () => "lease-retry",
      sleep: async (delay) => {
        delays.push(delay);
      },
    });

    expect(result.status).toBe("executed");
    expect(result.status === "executed" && result.journal.run.status).toBe(
      "succeeded_without_publish",
    );
    expect(delays).toEqual([100, 200]);
    expect(
      result.status === "executed" &&
        result.journal.attempts.map((attempt) => attempt.status),
    ).toEqual(["failed", "failed", "succeeded"]);
  });

  it("후보 없음은 오류가 아니라 후속 단계를 생략하고 정상 보류한다", async () => {
    let generateCalls = 0;
    const collect = stage("collect", async () => ({
      outcome: "withheld",
      reason: "NO_ELIGIBLE_TOPIC",
      inputFingerprint: hash("collect"),
      outputReference: "collect-output",
      usage: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        hasUnpricedCalls: false,
      },
    }));
    const generate = stage("generate", async () => {
      generateCalls += 1;
      throw new Error("should not execute");
    });
    const result = await runDailyPipeline({
      store: new TestDailyRunStore(),
      stages: [collect, generate],
      limits,
      runDate: "2026-08-13",
      now: clock(),
      createLeaseToken: () => "lease-withheld",
    });

    expect(result.status === "executed" && result.journal.run.status).toBe(
      "succeeded_without_publish",
    );
    expect(result.status === "executed" && result.journal.terminalReason).toBe(
      "NO_ELIGIBLE_TOPIC",
    );
    expect(generateCalls).toBe(0);
  });

  it("미가격 모델 사용은 publish 전에 blocked한다", async () => {
    let publishCalls = 0;
    const generate = stage("generate", async () => ({
      outcome: "succeeded",
      inputFingerprint: hash("generate"),
      outputReference: "generate-output",
      usage: {
        modelCalls: 1,
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0,
        hasUnpricedCalls: true,
      },
    }));
    const publish = stage("publish", async () => {
      publishCalls += 1;
      throw new Error("should not publish");
    });
    const result = await runDailyPipeline({
      store: new TestDailyRunStore(),
      stages: [generate, stage("validate"), publish],
      limits,
      runDate: "2026-08-13",
      now: clock(),
      createLeaseToken: () => "lease-unpriced",
    });

    expect(result.status === "executed" && result.journal.run.status).toBe(
      "blocked",
    );
    expect(result.status === "executed" && result.journal.terminalReason).toBe(
      "BUDGET_EXCEEDED",
    );
    expect(publishCalls).toBe(0);
  });

  it("모델 실패 사용량을 알 수 없으면 재시도 없이 예산 차단한다", async () => {
    let generateCalls = 0;
    const result = await runDailyPipeline({
      store: new TestDailyRunStore(),
      stages: [
        stage("generate", async () => {
          generateCalls += 1;
          throw new DailyStepError("MODEL_PROVIDER_ERROR", true);
        }),
      ],
      limits,
      runDate: "2026-08-13",
      now: clock(),
      createLeaseToken: () => "lease-model-failure",
      sleep: async () => {
        throw new Error("should not retry");
      },
    });

    expect(result.status === "executed" && result.journal.run.status).toBe(
      "blocked",
    );
    expect(result.status === "executed" && result.journal.terminalReason).toBe(
      "BUDGET_EXCEEDED",
    );
    expect(
      result.status === "executed" && result.journal.run.usage.hasUnpricedCalls,
    ).toBe(true);
    expect(generateCalls).toBe(1);
  });

  it("발행 타임아웃은 자동 재시도하지 않고 상태 불명으로 차단한다", async () => {
    let publishCalls = 0;
    const publish = stage("publish", async () => {
      publishCalls += 1;
      throw new DailyStepError("PUBLISH_TIMEOUT_AMBIGUOUS", false);
    });
    const result = await runDailyPipeline({
      store: new TestDailyRunStore(),
      stages: [stage("validate"), publish],
      limits,
      runDate: "2026-08-13",
      now: clock(),
      createLeaseToken: () => "lease-publish-timeout",
    });

    expect(result.status === "executed" && result.journal.run.status).toBe(
      "blocked",
    );
    expect(result.status === "executed" && result.journal.terminalReason).toBe(
      "PUBLISH_TIMEOUT_AMBIGUOUS",
    );
    expect(publishCalls).toBe(1);
  });

  it("캐시 갱신 실패는 이미 성공한 발행을 되돌리지 않는다", async () => {
    const result = await runDailyPipeline({
      store: new TestDailyRunStore(),
      stages: [
        stage("validate"),
        stage("publish"),
        stage(
          "cache_refresh",
          async () => {
            throw new DailyStepError("CACHE_REFRESH_FAILED", true);
          },
          2,
        ),
      ],
      limits,
      runDate: "2026-08-13",
      now: clock(),
      createLeaseToken: () => "lease-cache",
      sleep: async () => undefined,
    });

    expect(result.status === "executed" && result.journal.run.status).toBe(
      "published_with_warning",
    );
    expect(result.status === "executed" && result.journal.terminalReason).toBe(
      "CACHE_REFRESH_FAILED",
    );
    expect(
      result.status === "executed" &&
        result.journal.run.steps.find((item) => item.stage === "publish")?.status,
    ).toBe("succeeded");
  });

  it("활성 실행과 완료 실행을 재호출하면 handler를 실행하지 않는다", async () => {
    const store = new TestDailyRunStore();
    const pending = new Promise<void>(() => undefined);
    let calls = 0;
    const definition = stage("collect", async () => {
      calls += 1;
      await pending;
      throw new Error("unreachable");
    });
    const running = runDailyPipeline({
      store,
      stages: [definition],
      limits,
      runDate: "2026-08-13",
      now: clock(),
      createLeaseToken: () => "lease-running",
    });
    await Promise.resolve();
    await Promise.resolve();
    const busy = await runDailyPipeline({
      store,
      stages: [definition],
      limits,
      runDate: "2026-08-13",
      now: clock(),
      createLeaseToken: () => "lease-busy",
    });
    expect(busy.status).toBe("busy");
    expect(calls).toBe(1);
    void running;

    const terminalStore = new TestDailyRunStore();
    const completed = await runDailyPipeline({
      store: terminalStore,
      stages: [stage("collect")],
      limits,
      runDate: "2026-08-14",
      now: clock("2026-08-13T15:00:00.000Z"),
      createLeaseToken: () => "lease-complete",
    });
    expect(completed.status).toBe("executed");
    let rerunCalls = 0;
    const terminal = await runDailyPipeline({
      store: terminalStore,
      stages: [
        stage("collect", async () => {
          rerunCalls += 1;
          throw new Error("should not execute");
        }),
      ],
      limits,
      runDate: "2026-08-14",
      now: clock("2026-08-13T15:00:10.000Z"),
      createLeaseToken: () => "lease-rerun",
    });
    expect(terminal.status).toBe("already_terminal");
    expect(rerunCalls).toBe(0);
  });

  it("외부 중단 신호를 재시도하지 않고 종료 저널에 남긴다", async () => {
    const controller = new AbortController();
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let calls = 0;
    const running = runDailyPipeline({
      store: new TestDailyRunStore(),
      stages: [
        stage("collect", async () => {
          calls += 1;
          notifyStarted();
          return await new Promise<never>(() => undefined);
        }),
      ],
      limits,
      runDate: "2026-08-15",
      now: clock("2026-08-14T15:00:00.000Z"),
      createLeaseToken: () => "lease-aborted",
      abortSignal: controller.signal,
    });

    await started;
    controller.abort();
    const result = await running;

    expect(result.status === "executed" && result.journal.run.status).toBe(
      "failed",
    );
    expect(result.status === "executed" && result.journal.terminalReason).toBe(
      "RUN_ABORTED",
    );
    expect(result.status === "executed" && result.journal.attempts).toHaveLength(
      1,
    );
    expect(calls).toBe(1);
  });

  it("시작 전에 중단된 실행은 handler를 호출하지 않고 종료한다", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const result = await runDailyPipeline({
      store: new TestDailyRunStore(),
      stages: [
        stage("collect", async () => {
          calls += 1;
          throw new Error("should not execute");
        }),
      ],
      limits,
      runDate: "2026-08-15",
      now: clock("2026-08-14T15:00:00.000Z"),
      createLeaseToken: () => "lease-pre-aborted",
      abortSignal: controller.signal,
    });

    expect(result.status === "executed" && result.journal.terminalReason).toBe(
      "RUN_ABORTED",
    );
    expect(calls).toBe(0);
  });

  it("실제 메모리 저장소에서 만료된 실행을 회수하고 성공 단계는 재사용한다", async () => {
    const store = new MemoryDailyRunRepository();
    let currentTime = new Date("2026-08-15T15:00:00.000Z").getTime();
    const now = () => new Date(currentTime);
    let releaseFirst: () => void = () => undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let notifyNormalizeStarted: () => void = () => undefined;
    const normalizeStarted = new Promise<void>((resolve) => {
      notifyNormalizeStarted = resolve;
    });
    let collectCalls = 0;
    let normalizeCalls = 0;
    const normalizeContexts: Array<{
      leaseToken: string;
      leaseFence: number;
      journalRevision: number;
    }> = [];
    const definitions = [
      stage("collect", async () => {
        collectCalls += 1;
        return {
          outcome: "succeeded",
          inputFingerprint: hash("collect"),
          outputReference: "collect-output",
          usage: {
            modelCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
            hasUnpricedCalls: false,
          },
        };
      }),
      stage("normalize", async (context) => {
        normalizeCalls += 1;
        normalizeContexts.push({
          leaseToken: context.leaseToken,
          leaseFence: context.leaseFence,
          journalRevision: context.journalRevision,
        });
        if (normalizeCalls === 1) {
          notifyNormalizeStarted();
          await firstCanFinish;
        }
        expect(context.runId).toBe("original-run");
        return {
          outcome: "succeeded",
          inputFingerprint: hash("normalize"),
          outputReference: "normalize-output",
          usage: {
            modelCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
            hasUnpricedCalls: false,
          },
        };
      }),
    ];

    const first = runDailyPipeline({
      store,
      stages: definitions,
      limits,
      runDate: "2026-08-16",
      now,
      leaseDurationMs: 20_000,
      createRunId: () => "original-run",
      createLeaseToken: () => "lease-original",
    });
    await normalizeStarted;
    currentTime += 20_001;

    const recovered = await runDailyPipeline({
      store,
      stages: definitions,
      limits,
      runDate: "2026-08-16",
      now,
      leaseDurationMs: 20_000,
      createRunId: () => "replacement-run",
      createLeaseToken: () => "lease-replacement",
    });

    expect(recovered.status === "executed" && recovered.journal.run.status).toBe(
      "succeeded_without_publish",
    );
    expect(
      recovered.status === "executed" &&
        recovered.journal.attempts.map((attempt) => [
          attempt.stage,
          attempt.attemptNumber,
          attempt.errorCode,
        ]),
    ).toEqual([
      ["collect", 1, null],
      ["normalize", 1, "LEASE_EXPIRED"],
      ["normalize", 2, null],
    ]);
    expect(collectCalls).toBe(1);
    expect(normalizeCalls).toBe(2);
    expect(normalizeContexts).toEqual([
      {
        leaseToken: "lease-original",
        leaseFence: 1,
        journalRevision: 3,
      },
      {
        leaseToken: "lease-replacement",
        leaseFence: 2,
        journalRevision: 5,
      },
    ]);

    releaseFirst();
    await expect(first).rejects.toThrow();
  });

  it("산출물로 증명되지 않은 중단 모델 호출은 재호출하지 않고 미가격 사용량으로 차단한다", async () => {
    const store = new MemoryDailyRunRepository();
    let currentTime = new Date("2026-08-15T16:00:00.000Z").getTime();
    const now = () => new Date(currentTime);
    let release: () => void = () => undefined;
    const canFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let generateCalls = 0;
    const generate = stage("generate", async () => {
      generateCalls += 1;
      notifyStarted();
      await canFinish;
      return {
        outcome: "succeeded",
        inputFingerprint: hash("generate"),
        outputReference: "generate-output",
        usage: {
          modelCalls: 1,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.01,
          hasUnpricedCalls: false,
        },
      };
    });
    const first = runDailyPipeline({
      store,
      stages: [generate],
      limits,
      runDate: "2026-08-16",
      now,
      leaseDurationMs: 20_000,
      createLeaseToken: () => "lease-model-original",
    });
    await started;
    currentTime += 20_001;

    const recovered = await runDailyPipeline({
      store,
      stages: [generate],
      limits,
      runDate: "2026-08-16",
      now,
      leaseDurationMs: 20_000,
      createLeaseToken: () => "lease-model-recovered",
    });

    expect(recovered.status === "executed" && recovered.journal.run.status).toBe(
      "blocked",
    );
    expect(
      recovered.status === "executed" && recovered.journal.terminalReason,
    ).toBe("BUDGET_EXCEEDED");
    expect(
      recovered.status === "executed" &&
        recovered.journal.run.usage.hasUnpricedCalls,
    ).toBe(true);
    expect(generateCalls).toBe(1);

    release();
    await expect(first).rejects.toThrow();
  });

  it("중단된 publish는 영수증이 정확한 성공을 증명할 때만 재호출 없이 복구한다", async () => {
    const store = new MemoryDailyRunRepository();
    let currentTime = new Date("2026-08-15T16:00:00.000Z").getTime();
    const now = () => new Date(currentTime);
    let release: () => void = () => undefined;
    const canFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let publishCalls = 0;
    let receiptLookups = 0;
    const publish = stage("publish", async () => {
      publishCalls += 1;
      notifyStarted();
      await canFinish;
      return {
        outcome: "succeeded",
        inputFingerprint: hash("publish"),
        outputReference: "publish-output",
        usage: {
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          hasUnpricedCalls: false,
        },
      };
    });
    publish.reconcileInterrupted = async () => {
      receiptLookups += 1;
      return {
        outcome: "succeeded",
        inputFingerprint: hash("publish"),
        outputReference: "publish-output",
        usage: {
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          hasUnpricedCalls: false,
        },
      };
    };

    const first = runDailyPipeline({
      store,
      stages: [stage("validate"), publish],
      limits,
      runDate: "2026-08-16",
      now,
      leaseDurationMs: 20_000,
      createLeaseToken: () => "lease-publish-original",
    });
    await started;
    currentTime += 20_001;

    const recovered = await runDailyPipeline({
      store,
      stages: [stage("validate"), publish],
      limits,
      runDate: "2026-08-16",
      now,
      leaseDurationMs: 20_000,
      createLeaseToken: () => "lease-publish-recovered",
    });

    expect(recovered.status === "executed" && recovered.journal.run.status).toBe(
      "succeeded",
    );
    expect(
      recovered.status === "executed" &&
        recovered.journal.run.steps.find((step) => step.stage === "publish")
          ?.outputReference,
    ).toBe("publish-output");
    expect(publishCalls).toBe(1);
    expect(receiptLookups).toBe(1);

    release();
    await expect(first).rejects.toThrow();
  });

  it("영수증 복구 checkpoint 응답 유실 뒤에도 다음 lease가 publish를 재호출하지 않는다", async () => {
    const repository = new MemoryDailyRunRepository();
    let failRecoveredCheckpoint = false;
    const store: DailyRunStore = {
      acquireLease: (input) => repository.acquireLease(input),
      checkpoint: async (input) => {
        const committed = await repository.checkpoint(input);
        if (failRecoveredCheckpoint) {
          failRecoveredCheckpoint = false;
          throw new Error("simulated-checkpoint-response-loss");
        }
        return committed;
      },
      finish: (input) => repository.finish(input),
      get: (runDate) => repository.get(runDate),
    };
    let currentTime = new Date("2026-08-16T16:00:00.000Z").getTime();
    const now = () => new Date(currentTime);
    let release: () => void = () => undefined;
    const canFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let publishCalls = 0;
    let receiptLookups = 0;
    const publish = stage("publish", async () => {
      publishCalls += 1;
      notifyStarted();
      await canFinish;
      return {
        outcome: "succeeded",
        inputFingerprint: hash("publish"),
        outputReference: "publish-output",
        usage: {
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          hasUnpricedCalls: false,
        },
      };
    });
    publish.reconcileInterrupted = async () => {
      receiptLookups += 1;
      return {
        outcome: "succeeded",
        inputFingerprint: hash("publish"),
        outputReference: "publish-output",
        usage: {
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          hasUnpricedCalls: false,
        },
      };
    };
    const definitions = [stage("validate"), publish];
    const first = runDailyPipeline({
      store,
      stages: definitions,
      limits,
      runDate: "2026-08-17",
      now,
      leaseDurationMs: 20_000,
      createLeaseToken: () => "lease-response-loss-original",
    });
    await started;
    currentTime += 20_001;
    failRecoveredCheckpoint = true;

    await expect(
      runDailyPipeline({
        store,
        stages: definitions,
        limits,
        runDate: "2026-08-17",
        now,
        leaseDurationMs: 20_000,
        createLeaseToken: () => "lease-response-loss-second",
      }),
    ).rejects.toThrow();

    currentTime += 20_001;
    const recovered = await runDailyPipeline({
      store,
      stages: definitions,
      limits,
      runDate: "2026-08-17",
      now,
      leaseDurationMs: 20_000,
      createLeaseToken: () => "lease-response-loss-third",
    });

    expect(recovered.status === "executed" && recovered.journal.run.status).toBe(
      "succeeded",
    );
    expect(publishCalls).toBe(1);
    expect(receiptLookups).toBeGreaterThanOrEqual(1);

    release();
    await expect(first).rejects.toThrow();
  });

  it("정상 보류 finish 직전 중단 후에도 publish를 실행하지 않는다", async () => {
    const repository = new MemoryDailyRunRepository();
    let currentTime = new Date("2026-08-16T15:00:00.000Z").getTime();
    const now = () => new Date(currentTime);
    let failNextFinish = true;
    const crashBeforeFinishStore: DailyRunStore = {
      acquireLease: (input) => repository.acquireLease(input),
      checkpoint: (input) => repository.checkpoint(input),
      finish: async (input) => {
        if (failNextFinish) {
          failNextFinish = false;
          throw new Error("simulated-crash-before-finish");
        }
        return await repository.finish(input);
      },
      get: (runDate) => repository.get(runDate),
    };
    let collectCalls = 0;
    let publishCalls = 0;
    const definitions = [
      stage("collect", async () => {
        collectCalls += 1;
        return {
          outcome: "withheld",
          reason: "NO_ELIGIBLE_TOPIC",
          inputFingerprint: hash("collect"),
          outputReference: "collect-output",
          usage: {
            modelCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
            hasUnpricedCalls: false,
          },
        };
      }),
      stage("validate"),
      stage("publish", async () => {
        publishCalls += 1;
        return {
          outcome: "succeeded",
          inputFingerprint: hash("publish"),
          outputReference: "publish-output",
          usage: {
            modelCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
            hasUnpricedCalls: false,
          },
        };
      }),
    ];

    await expect(
      runDailyPipeline({
        store: crashBeforeFinishStore,
        stages: definitions,
        limits,
        runDate: "2026-08-17",
        now,
        leaseDurationMs: 20_000,
        createLeaseToken: () => "lease-before-finish",
      }),
    ).rejects.toThrow("simulated-crash-before-finish");

    currentTime += 20_001;
    const recovered = await runDailyPipeline({
      store: repository,
      stages: definitions,
      limits,
      runDate: "2026-08-17",
      now,
      leaseDurationMs: 20_000,
      createLeaseToken: () => "lease-after-finish-crash",
    });

    expect(recovered.status === "executed" && recovered.journal.run.status).toBe(
      "succeeded_without_publish",
    );
    expect(recovered.status === "executed" && recovered.journal.terminalReason).toBe(
      "NO_ELIGIBLE_TOPIC",
    );
    expect(collectCalls).toBe(2);
    expect(publishCalls).toBe(0);
  });

  it("발행 뒤 cache 실행권이 만료되면 발행 성공을 경고 상태로 보존한다", async () => {
    const store = new MemoryDailyRunRepository();
    let currentTime = new Date("2026-08-17T15:00:00.000Z").getTime();
    const now = () => new Date(currentTime);
    let releaseCache: () => void = () => undefined;
    const firstCacheCanFinish = new Promise<void>((resolve) => {
      releaseCache = resolve;
    });
    let notifyCacheStarted: () => void = () => undefined;
    const cacheStarted = new Promise<void>((resolve) => {
      notifyCacheStarted = resolve;
    });
    let publishCalls = 0;
    let cacheCalls = 0;
    const definitions = [
      stage("validate"),
      stage("publish", async () => {
        publishCalls += 1;
        return {
          outcome: "succeeded",
          inputFingerprint: hash("publish"),
          outputReference: "publish-output",
          usage: {
            modelCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
            hasUnpricedCalls: false,
          },
        };
      }),
      stage(
        "cache_refresh",
        async () => {
          cacheCalls += 1;
          notifyCacheStarted();
          await firstCacheCanFinish;
          return {
            outcome: "succeeded",
            inputFingerprint: hash("cache_refresh"),
            outputReference: "cache_refresh-output",
            usage: {
              modelCalls: 0,
              inputTokens: 0,
              outputTokens: 0,
              estimatedCostUsd: 0,
              hasUnpricedCalls: false,
            },
          };
        },
        1,
      ),
    ];

    const first = runDailyPipeline({
      store,
      stages: definitions,
      limits,
      runDate: "2026-08-18",
      now,
      leaseDurationMs: 20_000,
      createLeaseToken: () => "lease-cache-original",
    });
    await cacheStarted;
    currentTime += 20_001;

    const recovered = await runDailyPipeline({
      store,
      stages: definitions,
      limits,
      runDate: "2026-08-18",
      now,
      leaseDurationMs: 20_000,
      createLeaseToken: () => "lease-cache-recovered",
    });

    expect(recovered.status === "executed" && recovered.journal.run.status).toBe(
      "published_with_warning",
    );
    expect(recovered.status === "executed" && recovered.journal.terminalReason).toBe(
      "LEASE_EXPIRED",
    );
    expect(publishCalls).toBe(1);
    expect(cacheCalls).toBe(1);

    releaseCache();
    await expect(first).rejects.toThrow();
  });

  it("재개 단계 구성이나 완료 출력 검증이 달라지면 원자적으로 차단한다", async () => {
    const repository = new MemoryDailyRunRepository();
    let currentTime = new Date("2026-08-18T15:00:00.000Z").getTime();
    const now = () => new Date(currentTime);
    let crashAfterCollect = true;
    const crashStore: DailyRunStore = {
      acquireLease: (input) => repository.acquireLease(input),
      checkpoint: async (input) => {
        const saved = await repository.checkpoint(input);
        if (
          crashAfterCollect &&
          input.journal.run.steps[0]?.status === "succeeded"
        ) {
          crashAfterCollect = false;
          throw new Error("simulated-crash-after-collect");
        }
        return saved;
      },
      finish: (input) => repository.finish(input),
      get: (runDate) => repository.get(runDate),
    };
    const definitions = [stage("collect"), stage("normalize")];
    await expect(
      runDailyPipeline({
        store: crashStore,
        stages: definitions,
        limits,
        runDate: "2026-08-19",
        now,
        leaseDurationMs: 20_000,
        createLeaseToken: () => "lease-output-original",
      }),
    ).rejects.toMatchObject({ code: "STORE_UNAVAILABLE" });

    currentTime += 20_001;
    let normalizeCalls = 0;
    const result = await runDailyPipeline({
      store: repository,
      stages: [
        {
          ...stage("collect"),
          validateOutputReference: () => {
            throw new Error("stored output unavailable");
          },
        },
        stage("normalize", async () => {
          normalizeCalls += 1;
          throw new Error("should not execute");
        }),
      ],
      limits,
      runDate: "2026-08-19",
      now,
      leaseDurationMs: 20_000,
      createLeaseToken: () => "lease-output-recovered",
    });

    expect(result.status === "executed" && result.journal.run.status).toBe(
      "blocked",
    );
    expect(result.status === "executed" && result.journal.terminalReason).toBe(
      "PIPELINE_VERSION_MISMATCH",
    );
    expect(normalizeCalls).toBe(0);
  });
});
