import {
  runMemoryDailyPipeline,
} from "../src/pipeline/orchestrator";
import {
  MemoryDailyRunRepository,
  MemoryPipelineWorkspaceRepository,
} from "../src/repositories";
import { MemoryArticleRepository } from "../src/repositories/article-memory.repository";
import {
  createGeminiGeneration,
  GEMINI_FREE_MODEL_CHAIN,
} from "../src/lib/ai/gemini-factory";

const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const geminiEnabled =
  process.env.NODE_ENV !== "test" &&
  process.env.LLM_ENABLED === "true" &&
  process.env.LLM_PROVIDER === "gemini" &&
  process.env.GEMINI_FREE_TIER_DATA_USE_ACKNOWLEDGED === "true";
const gemini =
  geminiEnabled && geminiKey
    ? createGeminiGeneration({ apiKey: geminiKey })
    : null;
const generationBudget = {
  maxModelCalls: 4,
  maxInputTokens: 10_000,
  maxOutputTokens: 4_000,
  maxEstimatedCostUsd: 0.1,
  maxCallSeconds: 300,
} as const;

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
  generation: gemini
    ? {
        configurationId: `google-free:${GEMINI_FREE_MODEL_CHAIN.join(",")}`,
        provider: gemini.provider,
        semanticEvaluator: gemini.semanticEvaluator,
        budget: generationBudget,
      }
    : undefined,
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
        actualModelCalls: journal.run.usage.modelCalls > 0,
        geminiConfigured: gemini !== null,
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
