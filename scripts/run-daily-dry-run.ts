import { createHash } from "node:crypto";

import type { PipelineStage } from "../src/contracts";
import {
  runDailyPipeline,
  type DailyStageDefinition,
} from "../src/pipeline/orchestrator";
import { MemoryDailyRunRepository } from "../src/repositories";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dryRunStage(stage: PipelineStage): DailyStageDefinition {
  const inputFingerprint = hash(`daily-dry-run:${stage}:v1`);
  return {
    stage,
    inputFingerprint,
    retryPolicy: {
      maxAttempts: 1,
      initialDelayMs: 0,
      multiplier: 2,
      maxDelayMs: 0,
      timeoutMs: 5_000,
    },
    validateOutputReference: (reference) =>
      reference === `dry-run:${stage}:ok`,
    execute: async () => ({
      outcome: "succeeded",
      inputFingerprint,
      outputReference: `dry-run:${stage}:ok`,
      usage: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        hasUnpricedCalls: false,
      },
    }),
  };
}

const result = await runDailyPipeline({
  store: new MemoryDailyRunRepository(),
  stages: [
    dryRunStage("collect"),
    dryRunStage("normalize"),
    dryRunStage("deduplicate"),
    dryRunStage("score"),
    dryRunStage("retrieve"),
    dryRunStage("generate"),
    dryRunStage("validate"),
  ],
  limits: {
    maxModelCalls: 4,
    maxInputTokens: 10_000,
    maxOutputTokens: 4_000,
    maxEstimatedCostUsd: 1,
    maxRunSeconds: 60,
  },
  ownerId: "manual-dry-run",
  onEvent(event) {
    if (event.type === "run_finished") {
      console.log(JSON.stringify({ event: event.type, ...event }));
    }
  },
});

if (result.status === "busy") {
  console.log(
    JSON.stringify({
      event: "daily_dry_run_busy",
      runId: result.runId,
      ownerId: result.ownerId,
      expiresAt: result.expiresAt,
    }),
  );
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        event: "daily_dry_run_completed",
        status: result.status,
        runStatus: result.journal.run.status,
        runId: result.journal.run.runId,
        runDate: result.journal.run.runDate,
        attemptedStages: result.journal.attempts.map(
          (attempt) => attempt.stage,
        ),
        terminalReason: result.journal.terminalReason,
        externalWrites: false,
        actualNewsCollection: false,
        actualModelCalls: false,
        actualPublishing: false,
      },
      null,
      2,
    ),
  );
}
