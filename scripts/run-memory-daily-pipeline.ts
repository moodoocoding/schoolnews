import {
  runMemoryDailyPipeline,
} from "../src/pipeline/orchestrator";
import {
  MemoryDailyRunRepository,
  MemoryPipelineWorkspaceRepository,
} from "../src/repositories";
import { MemoryArticleRepository } from "../src/repositories/article-memory.repository";
import { collectRssSource } from "../src/pipeline/collectors";
import { createSupabaseSourceAttemptRpcDataSource } from "../src/db/supabase/source-attempt.data-source";
import { SupabaseSourceAttemptRepository } from "../src/repositories/supabase-source-attempt.repository";
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
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  console.error(
    JSON.stringify({
      event: "memory_daily_configuration_blocked",
      code: "SOURCE_INTERVAL_STORE_NOT_CONFIGURED",
      message:
        "Supabase Secret Key가 없어 출처별 호출 간격을 보장할 수 없습니다.",
    }),
  );
  process.exit(1);
}
const sourceAttemptRepository = new SupabaseSourceAttemptRepository(
  createSupabaseSourceAttemptRpcDataSource({
    projectUrl: supabaseUrl,
    secretKey: supabaseSecretKey,
  }),
);

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
  collectSource: async (source, signal) => {
    const reservation = await sourceAttemptRepository.reserve({
      sourceId: source.sourceId,
      minIntervalMs: source.requestPolicy.minIntervalMs,
    });
    if (reservation.status === "too_soon") {
      const now = new Date().toISOString();
      return {
        sourceId: source.sourceId,
        status: "failed",
        startedAt: now,
        finishedAt: now,
        items: [],
        issues: [
          {
            code: "SOURCE_UNAVAILABLE",
            message: "수집원 최소 호출 간격이 아직 지나지 않았습니다.",
            retryable: false,
            itemIndex: null,
          },
        ],
      };
    }
    return collectRssSource(source, { signal });
  },
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
