import "server-only";

import { createConfiguredSupabasePipelineRepositories } from "../../db/supabase/server";
import type { Environment } from "../config/env";
import { createGeminiRawRoutes } from "../ai/gemini-factory";
import { collectRssSource, RSS_SOURCE_REGISTRY } from "../../pipeline/collectors";
import {
  mapSupabasePublicationForGeneration,
  runSupabaseDailyPipeline,
} from "../../pipeline/orchestrator";
import type { ConfiguredSupabasePipelineRepositories } from "../../db/supabase/configured-pipeline.repositories";

export const PRODUCTION_GENERATION_BUDGET = Object.freeze({
  maxModelCalls: 4,
  maxInputTokens: 80_000,
  maxOutputTokens: 4_000,
  maxEstimatedCostUsd: 1,
  maxCallSeconds: 30,
});

export const PRODUCTION_RUN_LIMITS = Object.freeze({
  maxModelCalls: 4,
  maxInputTokens: 80_000,
  maxOutputTokens: 4_000,
  maxEstimatedCostUsd: 1,
  // Leaves at least one minute for authenticated initialization, terminal
  // checkpointing, and the HTTP response before the 300s function ceiling.
  maxRunSeconds: 240,
});

function createRepositories(environment: Environment) {
  const repositories: ConfiguredSupabasePipelineRepositories =
    createConfiguredSupabasePipelineRepositories(environment, {
    writeAuthority: () => {
      throw new Error("Explicit stage authority is required.");
    },
    publicationPostMapper: async (input) => {
      return mapSupabasePublicationForGeneration({
        workspace: repositories.workspace,
        runDate: input.runDate,
        runId: input.runId,
        generationOutputReference: input.generationOutputReference,
        generatedPost: input.generatedPost,
        qualityResult: input.qualityResult,
      });
    },
    });
  return repositories;
}

export async function runConfiguredSupabaseAutomation(input: {
  environment: Environment;
  ownerId: string;
  abortSignal?: AbortSignal;
}) {
  if (
    input.environment.AUTOMATION_MODE !== "live" ||
    input.environment.LLM_ENABLED !== "true" ||
    input.environment.GOOGLE_GENERATIVE_AI_API_KEY === undefined
  ) {
    throw new Error("LIVE_AUTOMATION_NOT_ENABLED");
  }

  const repositories = createRepositories(input.environment);
  // A history lookup failure is never replaced with an empty list. That keeps
  // novelty checks fail-closed when the read boundary is unavailable.
  const history = await repositories.publicationHistory.getRecent(365);
  const rawRoutes = createGeminiRawRoutes({
    apiKey: input.environment.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  return runSupabaseDailyPipeline({
    store: repositories.dailyRun,
    workspace: repositories.workspace,
    contentPersistence: repositories.contentPersistence,
    sourceAttempt: repositories.sourceAttempt,
    publisher: repositories.publisher,
    publishReceipt: repositories.publishReceipt,
    sources: RSS_SOURCE_REGISTRY,
    collectSource: (source, signal) => collectRssSource(source, { signal }),
    generation: {
      configurationId: `gemini-free-ledgered:${rawRoutes.modelChain.join(",")}`,
      ledger: repositories.modelInvocation,
      budget: PRODUCTION_GENERATION_BUDGET,
      generatedRoutes: rawRoutes.generatedRoutes,
      semanticRoutes: rawRoutes.semanticRoutes,
    },
    collectionConfigurationId: "licensed-production-sources-v1",
    previousPostTitles: history.titles,
    previousContentFingerprints: history.contentFingerprints,
    limits: PRODUCTION_RUN_LIMITS,
    ownerId: input.ownerId,
    abortSignal: input.abortSignal,
  });
}
