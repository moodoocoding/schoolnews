import { createHash } from "node:crypto";

import type {
  ArticleModelDocument,
  EvidenceItem,
  GenerationBudget,
  GenerationUsage,
  SourceRegistryEntry,
} from "../../contracts";
import {
  sourceRegistryEntrySchema,
} from "../../contracts";
import {
  createSupabasePipelineArtifactDescriptor,
  SupabaseContentPersistenceError,
  SupabasePipelineWorkspaceRepositoryError,
  type SupabaseContentPersistenceRepository,
  type SupabasePipelineWorkspaceArtifact,
  type SupabasePipelineWorkspaceRepository,
  type SupabasePipelineWorkspaceStoredArtifact,
  type SupabasePublishReceiptRepository,
  type SupabasePublisherRepository,
  type SupabaseSourceAttemptRepository,
  type SupabaseArticleFullTextRepository,
  type SupabaseEditorialMaterialsRepository,
} from "../../repositories";
import {
  FallbackGeneratedPostProvider,
  LedgeredGeneratedPostProvider,
  mapPostGenerationForDailyStage,
  type GeneratedPostGenerationRequest,
  type GeneratedPostProvider,
  type GeneratedPostProviderMetadata,
  type ModelInvocationLedger,
  type ModelInvocationReservation,
} from "../generation";
import {
  NewsIngestionAbortedError,
  runNewsIngestion,
  type RunNewsIngestionOptions,
  type NewsIngestionResult,
} from "./run-news-ingestion";
import {
  DAILY_TOPIC_SELECTION_VERSION,
  selectDailyTopic,
} from "./select-daily-topic";
import {
  EDITORIAL_ROLLING_WINDOW_DAYS,
  EDITORIAL_SOURCE_DATE_VERSION,
  selectEditorialWindowMaterials,
} from "./editorial-source-date";
import {
  decidePublicationCadence,
  PUBLICATION_CADENCE_VERSION,
  type PublicationCadenceMode,
} from "./publication-cadence";
import {
  POST_GENERATION_PIPELINE_VERSION,
  runPostGeneration,
  type PostGenerationSemanticEvaluator,
} from "./run-post-generation";
import { FallbackSemanticEvaluator } from "./fallback-semantic-evaluator";
import { LedgeredSemanticEvaluator } from "./ledgered-semantic-evaluator";
import {
  DailyStepError,
  DailyStageCommitUncertainError,
  runDailyPipeline,
  type DailyStageContext,
  type DailyStageDefinition,
  type RunDailyPipelineOptions,
} from "./run-daily-pipeline";
import { createSupabasePublicationStages } from "./supabase-publication-integration";

export const SUPABASE_DAILY_INTEGRATION_VERSION =
  "supabase-daily-integration-v2";

const EMPTY_USAGE: GenerationUsage = Object.freeze({
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  hasUnpricedCalls: false,
});

type GenerationRequest = Readonly<GeneratedPostGenerationRequest>;
type SemanticRequest = Parameters<PostGenerationSemanticEvaluator["evaluate"]>[0];

export interface SupabaseDailyGeneratedRoute {
  provider: GeneratedPostProvider;
  metadata: GeneratedPostProviderMetadata;
  promptVersion: string;
  reservationPolicyVersion: string;
  reservation:
    | ModelInvocationReservation
    | ((request: GenerationRequest) => ModelInvocationReservation);
}

export interface SupabaseDailySemanticRoute {
  evaluator: PostGenerationSemanticEvaluator;
  providerId: string;
  modelId: string;
  promptVersion: string;
  reservationPolicyVersion: string;
  reservation:
    | ModelInvocationReservation
    | ((request: Readonly<SemanticRequest>) => ModelInvocationReservation);
}

export interface SupabaseDailyGenerationConfiguration {
  configurationId: string;
  ledger: ModelInvocationLedger;
  budget: GenerationBudget;
  generatedRoutes: readonly SupabaseDailyGeneratedRoute[];
  semanticRoutes: readonly SupabaseDailySemanticRoute[];
  articleFullText?: Pick<SupabaseArticleFullTextRepository, "getSelected">;
  buildArticleDocuments?: (input: {
    evidenceItems: readonly EvidenceItem[];
    fullTexts: Awaited<
      ReturnType<SupabaseArticleFullTextRepository["getSelected"]>
    >;
    sources: readonly SourceRegistryEntry[];
  }) => ArticleModelDocument[];
}

type SupabaseDailyWorkspace = Pick<
  SupabasePipelineWorkspaceRepository,
  | "getArtifact"
  | "getArtifactForStage"
  | "getExactArtifactForStage"
  | "validateOutputReference"
  | "putArtifactWithAuthority"
>;

export interface CreateSupabaseDailyStagesOptions {
  /**
   * `dry_run` stops after the durable score artifact. It does not require or
   * construct model and publication dependencies. The default remains `live`
   * for backwards compatibility with the existing integration contract.
   */
  executionMode?: "dry_run" | "live";
  workspace: SupabaseDailyWorkspace;
  contentPersistence: Pick<
    SupabaseContentPersistenceRepository,
    | "persistCollectedContent"
    | "persistSelectedTopic"
    | "persistEmptyTopicSelection"
  >;
  /**
   * Deprecated compatibility input. Collection no longer calls this
   * repository or enforces a persisted minimum interval.
   */
  sourceAttempt?: Pick<SupabaseSourceAttemptRepository, "reserve">;
  publisher?: Pick<SupabasePublisherRepository, "publish">;
  publishReceipt?: Pick<SupabasePublishReceiptRepository, "get">;
  sources: readonly SourceRegistryEntry[];
  /** Required injection. This factory never falls back to a live RSS fetch. */
  collectSource: NonNullable<RunNewsIngestionOptions["collectSource"]>;
  generation?: SupabaseDailyGenerationConfiguration;
  collectionConfigurationId?: string;
  previousPostTitles?: readonly string[];
  previousContentFingerprints?: readonly string[];
  latestPublicationDateKst?: string | null;
  forceCadenceBootstrap?: boolean;
  /** Defaults to "quality_gated" -- see PublicationCadenceMode for what "daily_force" changes. */
  cadenceMode?: PublicationCadenceMode;
  editorialMaterials?: Pick<SupabaseEditorialMaterialsRepository, "getRolling">;
}

export interface RunSupabaseDailyPipelineOptions
  extends CreateSupabaseDailyStagesOptions,
    Omit<RunDailyPipelineOptions, "stages"> {}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalize(value: unknown): CanonicalValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  throw new TypeError("Supabase 실행 지문 입력이 유효하지 않습니다.");
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function inputFingerprint(
  configurationFingerprint: string,
  parentOutputReferences: readonly string[],
): string {
  return fingerprint({
    configurationFingerprint,
    parentOutputReferences: [...parentOutputReferences].sort(),
  });
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function authority(context: Readonly<DailyStageContext>) {
  return {
    runDate: context.runDate,
    runId: context.runId,
    leaseToken: context.leaseToken,
    fence: context.leaseFence,
    expectedRevision: context.journalRevision,
  } as const;
}

function stageAuthority(context: Readonly<DailyStageContext>) {
  return { ...authority(context), stage: context.stage } as const;
}

function persistedArtifact(
  descriptor: ReturnType<typeof createSupabasePipelineArtifactDescriptor>,
) {
  return {
    outputReference: descriptor.outputReference,
    payloadFingerprint: descriptor.payloadFingerprint,
    configurationFingerprint: descriptor.configurationFingerprint,
    payload: descriptor.payload,
  };
}

function generationUsage(value: Readonly<GenerationUsage>): GenerationUsage {
  return {
    modelCalls: value.modelCalls,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    estimatedCostUsd: value.estimatedCostUsd,
    hasUnpricedCalls: value.hasUnpricedCalls,
  };
}

function asDailyPersistenceError(error: unknown): DailyStepError {
  if (error instanceof SupabaseContentPersistenceError) {
    // The repository exposes only a bounded stable code. Log neither payloads,
    // article text, credentials nor the underlying remote error.
    console.error("daily_content_persistence_failure", error.code);
  } else {
    // An unexpected (non-repository) failure must never be silently folded
    // into INVALID_SOURCE_DATA without a trace. Only the error's own name is
    // stable and safe to log; the message may carry request/article details.
    console.error(
      "daily_content_persistence_unexpected_failure",
      error instanceof Error ? error.name : typeof error,
    );
  }
  if (
    error instanceof SupabaseContentPersistenceError &&
    error.code === "LEASE_EXPIRED"
  ) {
    return new DailyStepError("LEASE_EXPIRED", false, { cause: error });
  }
  return new DailyStepError("INVALID_SOURCE_DATA", false, { cause: error });
}

async function exactStoredLineage(input: {
  workspace: SupabaseDailyWorkspace;
  runId: string;
  stage: "collect" | "score" | "generate";
  kind: "news_ingestion" | "topic_selection" | "post_generation";
  configurationFingerprint: string;
  parentOutputReferences: readonly string[];
}): Promise<SupabasePipelineWorkspaceStoredArtifact | null> {
  const stored = await input.workspace.getArtifactForStage({
    runId: input.runId,
    stage: input.stage,
    kind: input.kind,
  });
  if (stored === null) return null;
  if (
    stored.configurationFingerprint !== input.configurationFingerprint ||
    !sameStrings(
      stored.parentOutputReferences,
      input.parentOutputReferences,
    )
  ) {
    throw new DailyStepError("PIPELINE_VERSION_MISMATCH", false);
  }
  return stored;
}

async function referenceMatches(input: {
  workspace: SupabaseDailyWorkspace;
  outputReference: string | null;
  runId?: string;
  stage: "collect" | "score" | "generate";
  kind: "news_ingestion" | "topic_selection" | "post_generation";
  configurationFingerprint: string;
  parentOutputReferences: readonly string[];
  verifiedReferences?: ReadonlySet<string>;
}): Promise<boolean> {
  if (input.outputReference === null || input.runId === undefined) return false;
  if (input.verifiedReferences?.has(input.outputReference)) return true;
  try {
    const stored = await exactStoredLineage({
      workspace: input.workspace,
      runId: input.runId,
      stage: input.stage,
      kind: input.kind,
      configurationFingerprint: input.configurationFingerprint,
      parentOutputReferences: input.parentOutputReferences,
    });
    return stored?.outputReference === input.outputReference;
  } catch {
    return false;
  }
}

function captureOnlyArticleRepository() {
  return {
    upsertMany: async (articles: readonly unknown[]) => ({
      insertedCount: articles.length,
      duplicateCount: 0,
      totalCount: articles.length,
    }),
  };
}

function carryRollingMaterials(
  result: Readonly<NewsIngestionResult>,
  historical: Readonly<{
    articles: Readonly<NewsIngestionResult["articles"]>;
    evidenceItems: Readonly<NewsIngestionResult["evidenceItems"]>;
  }>,
  allowedSourceIds: ReadonlySet<string>,
): NewsIngestionResult {
  const carriedArticles = historical.articles.filter((article) =>
    allowedSourceIds.has(article.sourceId),
  );
  const carriedArticleIds = new Set(
    carriedArticles.map((article) => article.articleId),
  );
  // A provider may correct punctuation or refresh its summary after the first
  // collection. Prefer the already persisted snapshot while it remains in the
  // seven-day editorial window so existing evidence lineage stays immutable.
  const currentArticles = result.articles.filter(
    (article) => !carriedArticleIds.has(article.articleId),
  );
  const currentArticleIds = new Set(
    currentArticles.map((article) => article.articleId),
  );
  const articleById = new Map(
    [...currentArticles, ...carriedArticles].map((article) => [article.articleId, article]),
  );
  const evidenceById = new Map(
    [
      ...result.evidenceItems.filter((item) =>
        currentArticleIds.has(item.articleId),
      ),
      ...historical.evidenceItems.filter((item) =>
        carriedArticleIds.has(item.articleId),
      ),
    ]
      .filter((item) => articleById.has(item.articleId))
      .map((item) => [item.evidenceId, item]),
  );
  return {
    ...structuredClone(result),
    carriedCount: carriedArticles.length,
    deduplicatedCount: currentArticles.length,
    storage: {
      insertedCount: currentArticles.length,
      duplicateCount: 0,
      totalCount: currentArticles.length,
    },
    articles: [...articleById.values()],
    evidenceItems: [...evidenceById.values()],
    candidates: result.candidates.filter((candidate) =>
      currentArticleIds.has(candidate.articleId),
    ),
  };
}

function restrictToRollingEditorialWindow(
  result: Readonly<NewsIngestionResult>,
  runDate: string,
): NewsIngestionResult {
  const materials = selectEditorialWindowMaterials({
    runDate,
    windowDays: EDITORIAL_ROLLING_WINDOW_DAYS,
    articles: result.articles,
    evidenceItems: result.evidenceItems,
  });
  const articleIds = new Set(
    materials.articles.map((article) => article.articleId),
  );
  return {
    ...structuredClone(result),
    deduplicatedCount: materials.articles.length,
    storage: {
      insertedCount: materials.articles.length,
      duplicateCount: 0,
      totalCount: materials.articles.length,
    },
    articles: materials.articles,
    evidenceItems: materials.evidenceItems,
    candidates: result.candidates.filter((candidate) =>
      articleIds.has(candidate.articleId),
    ),
  };
}

function historicalFallbackResult(input: {
  failedResult: Readonly<NewsIngestionResult>;
  historical: Readonly<{
    articles: Readonly<NewsIngestionResult["articles"]>;
    evidenceItems: Readonly<NewsIngestionResult["evidenceItems"]>;
  }>;
}): NewsIngestionResult {
  return {
    ...structuredClone(input.failedResult),
    // Network/source availability failures remain observable in outcomes, but
    // they do not discard already persisted, still-valid editorial material.
    status: "partial",
    carriedCount: input.historical.articles.length,
    // Carried articles were stored by earlier runs, so this run inserted
    // nothing. storage describes only this run's upserts and must stay
    // consistent with deduplicatedCount, which is zero when every source failed.
    storage: {
      insertedCount: 0,
      duplicateCount: 0,
      totalCount: 0,
    },
    articles: [...structuredClone(input.historical.articles)],
    evidenceItems: [...structuredClone(input.historical.evidenceItems)],
    candidates: [],
  };
}

function topicTitle(
  articles: readonly { articleId: string; title: string; publishedAt: string }[],
  articleIds: readonly string[],
): string {
  const allowed = new Set(articleIds);
  const first = articles
    .filter((article) => allowed.has(article.articleId))
    .sort(
      (left, right) =>
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
        left.articleId.localeCompare(right.articleId, "en"),
    )[0];
  if (!first) throw new DailyStepError("INVALID_SOURCE_DATA", false);
  return first.title;
}

function validateOptions(options: Readonly<CreateSupabaseDailyStagesOptions>) {
  const executionMode = options.executionMode ?? "live";
  const generation = options.generation;
  if (
    typeof options.collectSource !== "function" ||
    options.sources.length === 0 ||
    (executionMode === "live" &&
      (generation === undefined ||
        options.publisher === undefined ||
        options.publishReceipt === undefined ||
        generation.generatedRoutes.length < 1 ||
        generation.generatedRoutes.length > 2 ||
        generation.semanticRoutes.length < 1 ||
        generation.semanticRoutes.length > 2 ||
        generation.articleFullText === undefined ||
        generation.buildArticleDocuments === undefined ||
        generation.generatedRoutes.some(
          (route) =>
            typeof route.provider?.generate !== "function" ||
            !route.metadata?.providerId ||
            !route.metadata?.modelId ||
            !route.promptVersion?.trim() ||
            !route.reservationPolicyVersion?.trim(),
        ) ||
        generation.semanticRoutes.some(
          (route) =>
            typeof route.evaluator?.evaluate !== "function" ||
            !route.providerId ||
            !route.modelId ||
            !route.promptVersion?.trim() ||
            !route.reservationPolicyVersion?.trim(),
        )))
  ) {
    throw new TypeError("Supabase 일일 실행의 주입 구성이 완전하지 않습니다.");
  }
}

/**
 * Composes the persistent Supabase boundaries without importing configured
 * clients, environment variables, live RSS collectors, or Gemini factories.
 */
export function createSupabaseDailyStages(
  options: Readonly<CreateSupabaseDailyStagesOptions>,
): DailyStageDefinition[] {
  validateOptions(options);
  const parsedSources = options.sources.map((source) =>
    sourceRegistryEntrySchema.parse(source),
  );
  if (
    new Set(parsedSources.map((source) => source.sourceId)).size !==
    parsedSources.length
  ) {
    throw new TypeError("Supabase 수집원 ID는 고유해야 합니다.");
  }
  const sources = parsedSources
    .filter(
      (source) => source.enabled && source.accessStatus === "allowed",
    )
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId, "en"));
  if (sources.length === 0) {
    throw new TypeError("활성화된 Supabase 수집원이 필요합니다.");
  }
  const previousPostTitles = [...(options.previousPostTitles ?? [])].sort();
  const previousContentFingerprints = [
    ...(options.previousContentFingerprints ?? []),
  ].sort();
  const collectConfigurationFingerprint = fingerprint({
    version: SUPABASE_DAILY_INTEGRATION_VERSION,
    collectionConfigurationId:
      options.collectionConfigurationId ?? "supabase-collect-v1",
    sources,
    previousPostTitles,
    previousContentFingerprints,
  });
  const scoreConfigurationFingerprint = fingerprint({
    version: DAILY_TOPIC_SELECTION_VERSION,
    editorialSourceDateVersion: EDITORIAL_SOURCE_DATE_VERSION,
    publicationCadenceVersion: PUBLICATION_CADENCE_VERSION,
    latestPublicationDateKst: options.latestPublicationDateKst ?? null,
    forceCadenceBootstrap: options.forceCadenceBootstrap === true,
    cadenceMode: options.cadenceMode ?? "quality_gated",
    sources,
    previousPostTitles,
    previousContentFingerprints,
  });
  const verifiedArtifactReferences = new Set<string>();

  const collect: DailyStageDefinition = {
    stage: "collect",
    inputFingerprint: inputFingerprint(collectConfigurationFingerprint, []),
    retryPolicy: {
      // Attempt two can only reuse an exact committed 003 artifact.
      maxAttempts: 2,
      initialDelayMs: 0,
      multiplier: 1,
      maxDelayMs: 0,
      timeoutMs: 120_000,
    },
    validateOutputReference: (reference, _signal, context) =>
      referenceMatches({
        workspace: options.workspace,
        outputReference: reference,
        runId: context?.runId,
        stage: "collect",
        kind: "news_ingestion",
        configurationFingerprint: collectConfigurationFingerprint,
        parentOutputReferences: [],
        verifiedReferences: verifiedArtifactReferences,
      }),
    execute: async (context) => {
      const expectedInput = inputFingerprint(collectConfigurationFingerprint, []);
      const existing = await exactStoredLineage({
        workspace: options.workspace,
        runId: context.runId,
        stage: "collect",
        kind: "news_ingestion",
        configurationFingerprint: collectConfigurationFingerprint,
        parentOutputReferences: [],
      });
      if (existing) {
        verifiedArtifactReferences.add(existing.outputReference);
        return {
          outcome: "succeeded",
          inputFingerprint: expectedInput,
          outputReference: existing.outputReference,
          usage: EMPTY_USAGE,
        };
      }

      let result;
      try {
        result = await runNewsIngestion({
          articleRepository: captureOnlyArticleRepository(),
          sources,
          previousPostTitles,
          previousContentFingerprints,
          abortSignal: context.signal,
          collectSource: (source, signal) => options.collectSource(source, signal),
        });
      } catch (error) {
        if (error instanceof NewsIngestionAbortedError) {
          throw new DailyStepError("RUN_ABORTED", false, { cause: error });
        }
        throw error;
      }
      const historical = options.editorialMaterials
        ? await options.editorialMaterials.getRolling({
            runDate: context.runDate,
            windowDays: EDITORIAL_ROLLING_WINDOW_DAYS,
          })
        : { articles: [], evidenceItems: [] };
      if (result.status === "failed") {
        const issues = result.outcomes.flatMap((outcome) => outcome.issues);
        const unavailableOnly =
          issues.length > 0 &&
          issues.every(
            (issue) =>
              issue.code === "COLLECTION_TIMEOUT" ||
              issue.code === "SOURCE_UNAVAILABLE",
          );
        if (!unavailableOnly || historical.articles.length === 0) {
          throw new DailyStepError(
            issues.some((issue) => issue.code === "COLLECTION_TIMEOUT")
              ? "COLLECTION_TIMEOUT"
              : issues.some((issue) => issue.code === "SOURCE_UNAVAILABLE")
                ? "SOURCE_UNAVAILABLE"
                : "INVALID_SOURCE_DATA",
            false,
          );
        }
        result = historicalFallbackResult({ failedResult: result, historical });
      } else {
        result = restrictToRollingEditorialWindow(result, context.runDate);
      }
      // carryRollingMaterials below already drops any historical article
      // outside the currently active source registry, so a decommissioned,
      // renamed, or dev/test-seed source referenced by old evidence-bearing
      // rows must not block the whole collect stage. Log it for
      // observability instead of failing closed here.
      const evidenceArticleIds = new Set(
        historical.evidenceItems.map((item) => item.articleId),
      );
      const activeSourceIds = new Set(sources.map((source) => source.sourceId));
      const staleEvidenceSourceIds = new Set(
        historical.articles
          .filter(
            (article) =>
              evidenceArticleIds.has(article.articleId) &&
              !activeSourceIds.has(article.sourceId),
          )
          .map((article) => article.sourceId),
      );
      if (staleEvidenceSourceIds.size > 0) {
        console.error(
          "daily_collect_stale_evidence_source",
          [...staleEvidenceSourceIds].join(","),
        );
      }
      const resultWithHistory =
        result.carriedCount === historical.articles.length &&
        result.articles.length === historical.articles.length
          ? result
          : carryRollingMaterials(
              result,
              historical,
              new Set(sources.map((source) => source.sourceId)),
            );
      const writeInput = {
        runId: context.runId,
        stage: "collect" as const,
        configurationFingerprint: collectConfigurationFingerprint,
        parentOutputReferences: [],
        artifact: {
          kind: "news_ingestion" as const,
          value: resultWithHistory,
        },
      };
      const descriptor = createSupabasePipelineArtifactDescriptor(writeInput);
      try {
        await options.contentPersistence.persistCollectedContent({
          ...authority(context),
          sources,
          articles: resultWithHistory.articles,
          evidenceItems: resultWithHistory.evidenceItems,
          artifact: persistedArtifact(descriptor),
        });
      } catch (error) {
        if (
          !(error instanceof SupabaseContentPersistenceError) ||
          !error.ambiguous
        ) {
          throw asDailyPersistenceError(error);
        }
        try {
          const reconciled =
            await options.workspace.getExactArtifactForStage(writeInput);
          if (reconciled === null) {
            throw new DailyStageCommitUncertainError({ cause: error });
          }
        } catch (reconcileError) {
          if (reconcileError instanceof DailyStageCommitUncertainError) {
            throw reconcileError;
          }
          throw new DailyStageCommitUncertainError({ cause: reconcileError });
        }
      }
      verifiedArtifactReferences.add(descriptor.outputReference);
      return {
        outcome: "succeeded",
        inputFingerprint: expectedInput,
        outputReference: descriptor.outputReference,
        usage: EMPTY_USAGE,
      };
    },
  };

  const getCollect = (runId: string) =>
    exactStoredLineage({
      workspace: options.workspace,
      runId,
      stage: "collect",
      kind: "news_ingestion",
      configurationFingerprint: collectConfigurationFingerprint,
      parentOutputReferences: [],
    });

  const score: DailyStageDefinition = {
    stage: "score",
    inputFingerprint: null,
    resolveInputFingerprint: async ({ runId }) => {
      const parent = await getCollect(runId);
      if (!parent) throw new DailyStepError("INVALID_SOURCE_DATA", false);
      return inputFingerprint(scoreConfigurationFingerprint, [
        parent.outputReference,
      ]);
    },
    retryPolicy: {
      maxAttempts: 2,
      initialDelayMs: 0,
      multiplier: 1,
      maxDelayMs: 0,
      timeoutMs: 60_000,
    },
    validateOutputReference: async (reference, _signal, context) => {
      if (!context) return false;
      const parent = await getCollect(context.runId);
      if (!parent) return false;
      return referenceMatches({
        workspace: options.workspace,
        outputReference: reference,
        runId: context.runId,
        stage: "score",
        kind: "topic_selection",
        configurationFingerprint: scoreConfigurationFingerprint,
        parentOutputReferences: [parent.outputReference],
        verifiedReferences: verifiedArtifactReferences,
      });
    },
    execute: async (context) => {
      const collected = await getCollect(context.runId);
      if (!collected || collected.artifact.kind !== "news_ingestion") {
        throw new DailyStepError("INVALID_SOURCE_DATA", false);
      }
      const parents = [collected.outputReference];
      const expectedInput = inputFingerprint(scoreConfigurationFingerprint, parents);
      const existing = await exactStoredLineage({
        workspace: options.workspace,
        runId: context.runId,
        stage: "score",
        kind: "topic_selection",
        configurationFingerprint: scoreConfigurationFingerprint,
        parentOutputReferences: parents,
      });
      if (existing) {
        if (existing.artifact.kind !== "topic_selection") {
          throw new DailyStepError("INVALID_SOURCE_DATA", false);
        }
        verifiedArtifactReferences.add(existing.outputReference);
        return existing.artifact.value.outcome === "none"
          ? {
              outcome: "withheld",
              reason: "NO_ELIGIBLE_TOPIC",
              inputFingerprint: expectedInput,
              outputReference: existing.outputReference,
              usage: EMPTY_USAGE,
            }
          : {
              outcome: "succeeded",
              inputFingerprint: expectedInput,
              outputReference: existing.outputReference,
              usage: EMPTY_USAGE,
            };
      }

      const cadence = decidePublicationCadence({
        runDate: context.runDate,
        latestPublicationDateKst: options.latestPublicationDateKst ?? null,
        forceBootstrap: options.forceCadenceBootstrap,
        mode: options.cadenceMode,
      });
      const editorialMaterials = selectEditorialWindowMaterials({
        runDate: context.runDate,
        windowDays: cadence.candidateWindowDays,
        articles: collected.artifact.value.articles,
        evidenceItems: collected.artifact.value.evidenceItems,
      });
      const selection = selectDailyTopic({
        articles: editorialMaterials.articles,
        evidenceItems: editorialMaterials.evidenceItems,
        sources,
        previousPostTitles,
        previousContentFingerprints,
        publicationMode: cadence.forceBestCandidate ? "deadline" : "immediate",
      });
      const artifact: SupabasePipelineWorkspaceArtifact =
        selection.status === "none"
          ? {
              kind: "topic_selection",
              value: { outcome: "none", candidate: null, evidenceItems: [] },
            }
          : {
              kind: "topic_selection",
              value: {
                outcome: "eligible",
                candidate: selection.candidate,
                evidenceItems: selection.evidenceItems,
              },
            };
      const writeInput = {
        runId: context.runId,
        stage: "score" as const,
        configurationFingerprint: scoreConfigurationFingerprint,
        parentOutputReferences: parents,
        artifact,
      };
      const descriptor = createSupabasePipelineArtifactDescriptor(writeInput);
      try {
        if (selection.status === "none") {
          await options.contentPersistence.persistEmptyTopicSelection({
            ...authority(context),
            collectOutputReference: collected.outputReference,
            artifact: persistedArtifact(descriptor),
          });
        } else {
          await options.contentPersistence.persistSelectedTopic({
            ...authority(context),
            topicTitle: topicTitle(
              editorialMaterials.articles,
              selection.candidate.articleIds,
            ),
            candidate: selection.candidate,
            articles: editorialMaterials.articles,
            articleIdMapping: selection.candidate.articleIds.map((articleId) => ({
              inputArticleId: articleId,
              storedArticleId: articleId,
            })),
            evidenceIdMapping: selection.candidate.evidenceIds.map(
              (evidenceId) => ({
                inputEvidenceId: evidenceId,
                storedEvidenceId: evidenceId,
              }),
            ),
            collectOutputReference: collected.outputReference,
            artifact: persistedArtifact(descriptor),
          });
        }
      } catch (error) {
        if (
          !(error instanceof SupabaseContentPersistenceError) ||
          !error.ambiguous
        ) {
          throw asDailyPersistenceError(error);
        }
        try {
          const reconciled =
            await options.workspace.getExactArtifactForStage(writeInput);
          if (reconciled === null) {
            throw new DailyStageCommitUncertainError({ cause: error });
          }
        } catch (reconcileError) {
          if (reconcileError instanceof DailyStageCommitUncertainError) {
            throw reconcileError;
          }
          throw new DailyStageCommitUncertainError({ cause: reconcileError });
        }
      }
      verifiedArtifactReferences.add(descriptor.outputReference);
      return selection.status === "none"
        ? {
            outcome: "withheld",
            reason: "NO_ELIGIBLE_TOPIC",
            inputFingerprint: expectedInput,
            outputReference: descriptor.outputReference,
            usage: EMPTY_USAGE,
          }
        : {
            outcome: "succeeded",
            inputFingerprint: expectedInput,
            outputReference: descriptor.outputReference,
            usage: EMPTY_USAGE,
          };
    },
  };

  const getScore = async (runId: string) => {
    const parent = await getCollect(runId);
    if (!parent) throw new DailyStepError("INVALID_SOURCE_DATA", false);
    return exactStoredLineage({
      workspace: options.workspace,
      runId,
      stage: "score",
      kind: "topic_selection",
      configurationFingerprint: scoreConfigurationFingerprint,
      parentOutputReferences: [parent.outputReference],
    });
  };

  if ((options.executionMode ?? "live") === "dry_run") {
    return [collect, score];
  }

  const generation = options.generation;
  const publisher = options.publisher;
  const publishReceipt = options.publishReceipt;
  if (!generation || !publisher || !publishReceipt) {
    throw new TypeError("Supabase live 실행 의존성이 완전하지 않습니다.");
  }
  const generationConfigurationFingerprint = fingerprint({
    version: POST_GENERATION_PIPELINE_VERSION,
    configurationId: generation.configurationId,
    budget: generation.budget,
    generatedRoutes: generation.generatedRoutes.map((route) => ({
      ...route.metadata,
      promptVersion: route.promptVersion,
      reservationPolicyVersion: route.reservationPolicyVersion,
    })),
    semanticRoutes: generation.semanticRoutes.map((route) => ({
      providerId: route.providerId,
      modelId: route.modelId,
      promptVersion: route.promptVersion,
      reservationPolicyVersion: route.reservationPolicyVersion,
    })),
  });

  const generate: DailyStageDefinition = {
    stage: "generate",
    inputFingerprint: null,
    resolveInputFingerprint: async ({ runId }) => {
      const parent = await getScore(runId);
      if (!parent) throw new DailyStepError("INVALID_SOURCE_DATA", false);
      return inputFingerprint(generationConfigurationFingerprint, [
        parent.outputReference,
      ]);
    },
    canRecoverInterrupted: async ({ runId }) => {
      const parent = await getScore(runId);
      if (!parent) return false;
      return (
        (await exactStoredLineage({
          workspace: options.workspace,
          runId,
          stage: "generate",
          kind: "post_generation",
          configurationFingerprint: generationConfigurationFingerprint,
          parentOutputReferences: [parent.outputReference],
        })) !== null
      );
    },
    retryPolicy: {
      maxAttempts: 2,
      initialDelayMs: 0,
      multiplier: 1,
      maxDelayMs: 0,
      timeoutMs: Math.min(
        900_000,
        Math.max(
          5_000,
          generation.budget.maxCallSeconds *
            generation.budget.maxModelCalls *
            1_000 +
            generation.budget.maxModelCalls * 30_000 +
            35_000,
        ),
      ),
    },
    validateOutputReference: async (reference, _signal, context) => {
      if (!context) return false;
      const parent = await getScore(context.runId);
      if (!parent) return false;
      return referenceMatches({
        workspace: options.workspace,
        outputReference: reference,
        runId: context.runId,
        stage: "generate",
        kind: "post_generation",
        configurationFingerprint: generationConfigurationFingerprint,
        parentOutputReferences: [parent.outputReference],
        verifiedReferences: verifiedArtifactReferences,
      });
    },
    execute: async (context) => {
      const selected = await getScore(context.runId);
      if (
        !selected ||
        selected.artifact.kind !== "topic_selection" ||
        selected.artifact.value.outcome !== "eligible" ||
        selected.artifact.value.candidate === null
      ) {
        throw new DailyStepError("INVALID_SOURCE_DATA", false, {
          usage: EMPTY_USAGE,
        });
      }
      const parents = [selected.outputReference];
      const expectedInput = inputFingerprint(
        generationConfigurationFingerprint,
        parents,
      );
      const existing = await exactStoredLineage({
        workspace: options.workspace,
        runId: context.runId,
        stage: "generate",
        kind: "post_generation",
        configurationFingerprint: generationConfigurationFingerprint,
        parentOutputReferences: parents,
      });
      const storedResult = existing?.artifact;
      if (storedResult && storedResult.kind !== "post_generation") {
        throw new DailyStepError("INVALID_SOURCE_DATA", false, {
          usage: EMPTY_USAGE,
        });
      }

      let postGeneration = storedResult?.value;
      if (!postGeneration) {
        const evidenceItems = selected.artifact.value.evidenceItems;
        const usesOnlyApiSummaries = evidenceItems.every(
          (item) => item.locator === "뉴스 검색 API 요약",
        );
        const fullTexts = usesOnlyApiSummaries
          ? []
          : await generation.articleFullText!.getSelected({
              ...authority(context),
              scoreOutputReference: selected.outputReference,
              evidenceIds: evidenceItems.map((item) => item.evidenceId),
              articleIds: evidenceItems.map((item) => item.articleId),
            });
        const articleDocuments = generation.buildArticleDocuments!({
          evidenceItems,
          fullTexts,
          sources,
        });
        const invocationAuthority = authority(context);
        const provider = new FallbackGeneratedPostProvider(
          generation.generatedRoutes.map(
            (route, index) =>
              new LedgeredGeneratedPostProvider({
                provider: route.provider,
                ledger: generation.ledger,
                authority: invocationAuthority,
                metadata: route.metadata,
                routeAttempt: (index + 1) as 1 | 2,
                scoreOutputReference: selected.outputReference,
                reservation: route.reservation,
                promptVersion: route.promptVersion,
              }),
          ),
        );
        const semanticEvaluator = new FallbackSemanticEvaluator(
          generation.semanticRoutes.map(
            (route, index) =>
              new LedgeredSemanticEvaluator({
                evaluator: route.evaluator,
                ledger: generation.ledger,
                authority: invocationAuthority,
                providerId: route.providerId,
                modelId: route.modelId,
                routeAttempt: (index + 1) as 1 | 2,
                scoreOutputReference: selected.outputReference,
                reservation: route.reservation,
                promptVersion: route.promptVersion,
              }),
          ),
        );
        postGeneration = await runPostGeneration({
          provider,
          semanticEvaluator,
          evidenceItems: selected.artifact.value.evidenceItems,
          articleDocuments,
          evidencePolicy: selected.artifact.value.candidate.evidencePolicy,
          budget: generation.budget,
          abortSignal: context.signal,
        });
      }
      const mapping = mapPostGenerationForDailyStage(postGeneration);
      if (mapping.disposition === "failed") {
        throw new DailyStepError(mapping.errorCode, false, {
          usage: generationUsage(mapping.usage),
        });
      }
      const writeInput = {
        runId: context.runId,
        stage: "generate" as const,
        configurationFingerprint: generationConfigurationFingerprint,
        parentOutputReferences: parents,
        artifact: {
          kind: "post_generation" as const,
          value: postGeneration,
        },
      };
      let outputReference = existing?.outputReference;
      if (!existing) {
        try {
          outputReference = (
            await options.workspace.putArtifactWithAuthority(
              writeInput,
              stageAuthority(context),
            )
          ).outputReference;
        } catch (error) {
          if (
            !(error instanceof SupabasePipelineWorkspaceRepositoryError) ||
            error.code !== "DATA_API_ERROR"
          ) {
            throw error;
          }
          try {
            const reconciled =
              await options.workspace.getExactArtifactForStage(writeInput);
            if (reconciled === null) {
              throw new DailyStageCommitUncertainError({ cause: error });
            }
            outputReference = reconciled.outputReference;
          } catch (reconcileError) {
            if (reconcileError instanceof DailyStageCommitUncertainError) {
              throw reconcileError;
            }
            throw new DailyStageCommitUncertainError({
              cause: reconcileError,
            });
          }
        }
      }
      if (!outputReference) {
        throw new DailyStepError("INVALID_SOURCE_DATA", false, {
          usage: generationUsage(mapping.usage),
        });
      }
      verifiedArtifactReferences.add(outputReference);
      return mapping.disposition === "ready"
        ? {
            outcome: "succeeded",
            inputFingerprint: expectedInput,
            outputReference,
            usage: generationUsage(mapping.usage),
          }
        : {
            outcome: "withheld",
            reason: mapping.reason,
            inputFingerprint: expectedInput,
            outputReference,
            usage: generationUsage(mapping.usage),
          };
    },
  };

  const publication = createSupabasePublicationStages({
    workspace: options.workspace,
    publisher,
    publishReceipt,
    configurationId: `${generation.configurationId}:publication-v1`,
  });
  const stages = [collect, score, generate, ...publication];
  if (
    stages.map((stage) => stage.stage).join(",") !==
    "collect,score,generate,validate,publish"
  ) {
    throw new TypeError("Supabase 일일 실행 단계 순서가 유효하지 않습니다.");
  }
  return stages;
}

export async function runSupabaseDailyPipeline(
  options: Readonly<RunSupabaseDailyPipelineOptions>,
) {
  const stages = createSupabaseDailyStages(options);
  const minimumLeaseDurationMs = Math.max(
    ...stages.map((stage) => stage.retryPolicy.timeoutMs + 1_000),
    ...stages.map((stage) => stage.retryPolicy.maxDelayMs + 1_000),
  );
  return runDailyPipeline({
    ...options,
    stages,
    leaseDurationMs: options.leaseDurationMs ?? minimumLeaseDurationMs,
  });
}
