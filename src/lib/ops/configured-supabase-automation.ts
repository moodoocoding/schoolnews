import "server-only";

import { createConfiguredSupabasePipelineRepositories } from "../../db/supabase/server";
import type { Environment } from "../config/env";
import { createGeminiRawRoutes } from "../ai/gemini-factory";
import {
  collectNaverNewsSources,
  collectRssSource,
  createNaverPublisherSources,
  RSS_SOURCE_REGISTRY,
} from "../../pipeline/collectors";
import {
  mapSupabasePublicationForGeneration,
  runSupabaseDailyPipeline,
} from "../../pipeline/orchestrator";
import type { ConfiguredSupabasePipelineRepositories } from "../../db/supabase/configured-pipeline.repositories";
import { buildArticleModelDocuments } from "../../repositories";

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

export const CADENCE_BOOTSTRAP_RUN_DATE = "2026-08-14";

function currentKstDate(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

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
  const naverSources = createNaverPublisherSources();
  const sources = [...RSS_SOURCE_REGISTRY, ...naverSources];
  let naverOutcomesPromise:
    | ReturnType<typeof collectNaverNewsSources>
    | undefined;

  return runSupabaseDailyPipeline({
    store: repositories.dailyRun,
    workspace: repositories.workspace,
    contentPersistence: repositories.contentPersistence,
    sourceAttempt: repositories.sourceAttempt,
    editorialMaterials: repositories.editorialMaterials,
    publisher: repositories.publisher,
    publishReceipt: repositories.publishReceipt,
    sources,
    collectSource: async (source, signal) => {
      if (source.collectionType === "rss") {
        return collectRssSource(source, { signal });
      }
      naverOutcomesPromise ??= collectNaverNewsSources({
        sources: naverSources,
        signal,
      });
      const outcome = (await naverOutcomesPromise).get(source.sourceId);
      if (outcome === undefined) {
        throw new Error("NAVER_NEWS_SOURCE_OUTCOME_MISSING");
      }
      return outcome;
    },
    generation: {
      configurationId: `gemini-free-ledgered:${rawRoutes.modelChain.join(",")}`,
      ledger: repositories.modelInvocation,
      budget: PRODUCTION_GENERATION_BUDGET,
      generatedRoutes: rawRoutes.generatedRoutes,
      semanticRoutes: rawRoutes.semanticRoutes,
      articleFullText: repositories.articleFullText,
      buildArticleDocuments: (documents) =>
        buildArticleModelDocuments({
          ...documents,
          apiSummarySources: documents.sources,
        }),
    },
    collectionConfigurationId: "official-rss-and-naver-summaries-v4",
    previousPostTitles: history.titles,
    previousContentFingerprints: history.contentFingerprints,
    latestPublicationDateKst: history.latestPublicationDateKst,
    forceCadenceBootstrap: currentKstDate() === CADENCE_BOOTSTRAP_RUN_DATE,
    limits: PRODUCTION_RUN_LIMITS,
    ownerId: input.ownerId,
    abortSignal: input.abortSignal,
  });
}
