import {
  runMemoryDailyPipeline,
} from "../src/pipeline/orchestrator";
import {
  MemoryDailyRunRepository,
  MemoryPipelineWorkspaceRepository,
} from "../src/repositories";
import { MemoryArticleRepository } from "../src/repositories/article-memory.repository";

const result = await runMemoryDailyPipeline({
  store: new MemoryDailyRunRepository(),
  workspace: new MemoryPipelineWorkspaceRepository(),
  articleRepository: new MemoryArticleRepository(),
  limits: {
    maxModelCalls: 4,
    maxInputTokens: 10_000,
    maxOutputTokens: 4_000,
    maxEstimatedCostUsd: 1,
    maxRunSeconds: 300,
  },
  ownerId: "manual-memory-daily",
  collectionConfigurationId: "official-rss-live-v1",
});

if (result.status === "busy") {
  console.log(
    JSON.stringify({
      event: "memory_daily_busy",
      runId: result.runId,
      expiresAt: result.expiresAt,
    }),
  );
  process.exitCode = 1;
} else {
  const journal = result.journal;
  console.log(
    JSON.stringify(
      {
        event: "memory_daily_completed",
        status: result.status,
        runStatus: journal.run.status,
        runId: journal.run.runId,
        runDate: journal.run.runDate,
        attemptedStages: journal.attempts.map((attempt) => attempt.stage),
        terminalReason: journal.terminalReason,
        usage: journal.run.usage,
        datastore: "process_memory",
        actualNewsCollection: true,
        actualModelCalls: false,
        actualPublishing: false,
        firestoreUsed: false,
      },
      null,
      2,
    ),
  );
  if (["failed", "blocked"].includes(journal.run.status)) {
    process.exitCode = 1;
  }
}
