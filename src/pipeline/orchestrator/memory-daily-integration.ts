import { createHash } from "node:crypto";

import type {
  ArticleModelDocument,
  EvidenceItem,
  GenerationBudget,
  GenerationUsage,
  SourceRegistryEntry,
} from "../../contracts";
import type { GeneratedPostProvider } from "../generation";
import { mapPostGenerationForDailyStage } from "../generation";
import { RSS_SOURCE_REGISTRY } from "../collectors";
import type { IngestedArticleRepository, RunNewsIngestionOptions } from "./run-news-ingestion";
import {
  NewsIngestionAbortedError,
  runNewsIngestion,
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
  POST_GENERATION_PIPELINE_VERSION,
  runPostGeneration,
  type PostGenerationSemanticEvaluator,
} from "./run-post-generation";
import {
  DailyStepError,
  runDailyPipeline,
  type DailyStageDefinition,
  type RunDailyPipelineOptions,
} from "./run-daily-pipeline";
import {
  MemoryPipelineWorkspaceRepository,
  type PipelineWorkspaceArtifactKind,
  type PipelineWorkspaceStoredArtifact,
} from "../../repositories/memory-pipeline-workspace.repository";

export const MEMORY_DAILY_INTEGRATION_VERSION = "memory-daily-integration-v2";

const EMPTY_USAGE = Object.freeze({
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  hasUnpricedCalls: false,
});

interface MemoryDailyGenerationConfiguration {
  /** Stable identifier for the provider, model, prompt and evaluator setup. */
  configurationId: string;
  provider: GeneratedPostProvider;
  semanticEvaluator: PostGenerationSemanticEvaluator;
  budget: GenerationBudget;
  articleDocumentsForEvidence?: (
    evidenceItems: readonly EvidenceItem[],
  ) => readonly ArticleModelDocument[];
}

export interface CreateMemoryDailyStagesOptions {
  workspace: MemoryPipelineWorkspaceRepository;
  articleRepository: IngestedArticleRepository;
  sources?: readonly SourceRegistryEntry[];
  collectSource?: RunNewsIngestionOptions["collectSource"];
  collectionConfigurationId?: string;
  previousPostTitles?: readonly string[];
  previousContentFingerprints?: readonly string[];
  generation?: MemoryDailyGenerationConfiguration;
}

export interface RunMemoryDailyPipelineOptions
  extends CreateMemoryDailyStagesOptions,
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
  throw new TypeError("설정 지문에 직렬화할 수 없는 값이 있습니다.");
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

async function exactArtifact(input: {
  workspace: MemoryPipelineWorkspaceRepository;
  runId: string;
  stage: "collect" | "score" | "generate";
  kind: PipelineWorkspaceArtifactKind;
  configurationFingerprint: string;
  parentOutputReferences: readonly string[];
}): Promise<PipelineWorkspaceStoredArtifact | null> {
  const stored = await input.workspace.getArtifactForStage({
    runId: input.runId,
    stage: input.stage,
    kind: input.kind,
  });
  if (stored === null) return null;
  if (
    stored.configurationFingerprint !== input.configurationFingerprint ||
    !sameStrings(stored.parentOutputReferences, input.parentOutputReferences)
  ) {
    throw new DailyStepError("PIPELINE_VERSION_MISMATCH", false);
  }
  return stored;
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

function generationUsage(value: Readonly<GenerationUsage>) {
  return {
    modelCalls: value.modelCalls,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    estimatedCostUsd: value.estimatedCostUsd,
    hasUnpricedCalls: value.hasUnpricedCalls,
  };
}

/**
 * Composes the existing M2 collector/selector and M3 composite generation flow
 * into M4 without publishing or using Firestore. Artifacts are process-local.
 */
export function createMemoryDailyStages(
  options: Readonly<CreateMemoryDailyStagesOptions>,
): DailyStageDefinition[] {
  if (
    options.generation &&
    (typeof options.generation.provider?.generate !== "function" ||
      typeof options.generation.semanticEvaluator?.evaluate !== "function" ||
      typeof options.generation.articleDocumentsForEvidence !== "function")
  ) {
    throw new TypeError(
      "생성 설정에는 생성 공급자, 독립 의미 평가기, 기사 원문 공급자가 모두 필요합니다.",
    );
  }
  const sources = [...(options.sources ?? RSS_SOURCE_REGISTRY)].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId, "en"),
  );
  const previousPostTitles = [...(options.previousPostTitles ?? [])].sort();
  const previousContentFingerprints = [
    ...(options.previousContentFingerprints ?? []),
  ].sort();
  const collectConfigurationFingerprint = fingerprint({
    version: MEMORY_DAILY_INTEGRATION_VERSION,
    collectionConfigurationId:
      options.collectionConfigurationId ?? "official-rss-live-v1",
    sources,
    previousPostTitles,
    previousContentFingerprints,
  });
  const scoreConfigurationFingerprint = fingerprint({
    version: DAILY_TOPIC_SELECTION_VERSION,
    editorialSourceDateVersion: EDITORIAL_SOURCE_DATE_VERSION,
    sources,
    previousPostTitles,
    previousContentFingerprints,
  });
  const generationConfigurationFingerprint = fingerprint({
    version: POST_GENERATION_PIPELINE_VERSION,
    configurationId: options.generation?.configurationId ?? "disabled",
    budget: options.generation?.budget ?? null,
  });

  const getParent = async (
    runId: string,
    stage: "collect" | "score",
    kind: "news_ingestion" | "topic_selection",
    configurationFingerprint: string,
    parents: readonly string[],
  ): Promise<PipelineWorkspaceStoredArtifact> => {
    const parent = await exactArtifact({
      workspace: options.workspace,
      runId,
      stage,
      kind,
      configurationFingerprint,
      parentOutputReferences: parents,
    });
    if (parent === null) throw new DailyStepError("INVALID_SOURCE_DATA", false);
    return parent;
  };

  const collect: DailyStageDefinition = {
    stage: "collect",
    inputFingerprint: inputFingerprint(collectConfigurationFingerprint, []),
    retryPolicy: {
      // The active official source declares a 24-hour minimum interval.
      maxAttempts: 1,
      initialDelayMs: 0,
      multiplier: 1,
      maxDelayMs: 0,
      timeoutMs: 120_000,
    },
    validateOutputReference: async (reference) => {
      if (
        !(await options.workspace.validateOutputReference(reference, {
          stage: "collect",
          kind: "news_ingestion",
        })) ||
        reference === null
      ) {
        return false;
      }
      const metadata = await options.workspace.getArtifactMetadata(reference);
      return metadata.configurationFingerprint === collectConfigurationFingerprint;
    },
    execute: async (context) => {
      const expectedInput = inputFingerprint(collectConfigurationFingerprint, []);
      const existing = await exactArtifact({
        workspace: options.workspace,
        runId: context.runId,
        stage: "collect",
        kind: "news_ingestion",
        configurationFingerprint: collectConfigurationFingerprint,
        parentOutputReferences: [],
      });
      if (existing) {
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
          articleRepository: options.articleRepository,
          sources,
          collectSource: options.collectSource,
          abortSignal: context.signal,
          previousPostTitles,
          previousContentFingerprints,
        });
      } catch (error) {
        if (error instanceof NewsIngestionAbortedError) {
          throw new DailyStepError("RUN_ABORTED", false, { cause: error });
        }
        throw error;
      }
      if (result.status === "failed") {
        const issues = result.outcomes.flatMap((outcome) => outcome.issues);
        const code = issues.some((issue) => issue.code === "COLLECTION_TIMEOUT")
          ? "COLLECTION_TIMEOUT"
          : issues.some((issue) => issue.code === "SOURCE_UNAVAILABLE")
            ? "SOURCE_UNAVAILABLE"
            : "INVALID_SOURCE_DATA";
        throw new DailyStepError(code, false);
      }
      const stored = await options.workspace.putArtifact({
        runId: context.runId,
        stage: "collect",
        configurationFingerprint: collectConfigurationFingerprint,
        parentOutputReferences: [],
        artifact: { kind: "news_ingestion", value: result },
      });
      return {
        outcome: "succeeded",
        inputFingerprint: expectedInput,
        outputReference: stored.outputReference,
        usage: EMPTY_USAGE,
      };
    },
  };

  const score: DailyStageDefinition = {
    stage: "score",
    inputFingerprint: null,
    resolveInputFingerprint: async ({ runId }) => {
      const parent = await getParent(
        runId,
        "collect",
        "news_ingestion",
        collectConfigurationFingerprint,
        [],
      );
      return inputFingerprint(scoreConfigurationFingerprint, [
        parent.outputReference,
      ]);
    },
    retryPolicy: {
      maxAttempts: 1,
      initialDelayMs: 0,
      multiplier: 1,
      maxDelayMs: 0,
      timeoutMs: 15_000,
    },
    validateOutputReference: async (reference) => {
      if (
        !(await options.workspace.validateOutputReference(reference, {
          stage: "score",
          kind: "topic_selection",
        })) ||
        reference === null
      ) {
        return false;
      }
      const metadata = await options.workspace.getArtifactMetadata(reference);
      return metadata.configurationFingerprint === scoreConfigurationFingerprint;
    },
    execute: async (context) => {
      const collected = await getParent(
        context.runId,
        "collect",
        "news_ingestion",
        collectConfigurationFingerprint,
        [],
      );
      const parents = [collected.outputReference];
      const expectedInput = inputFingerprint(scoreConfigurationFingerprint, parents);
      const existing = await exactArtifact({
        workspace: options.workspace,
        runId: context.runId,
        stage: "score",
        kind: "topic_selection",
        configurationFingerprint: scoreConfigurationFingerprint,
        parentOutputReferences: parents,
      });
      if (existing) {
        const selection = existing.artifact;
        if (selection.kind !== "topic_selection") {
          throw new DailyStepError("INVALID_SOURCE_DATA", false);
        }
        return selection.value.outcome === "none"
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
      if (collected.artifact.kind !== "news_ingestion") {
        throw new DailyStepError("INVALID_SOURCE_DATA", false);
      }
      const editorialMaterials = selectEditorialWindowMaterials({
        runDate: context.runDate,
        windowDays: EDITORIAL_ROLLING_WINDOW_DAYS,
        articles: collected.artifact.value.articles,
        evidenceItems: collected.artifact.value.evidenceItems,
      });
      const selected = selectDailyTopic({
        articles: editorialMaterials.articles,
        evidenceItems: editorialMaterials.evidenceItems,
        sources,
        previousPostTitles,
        previousContentFingerprints,
        publicationMode: "deadline",
      });
      const workspaceValue =
        selected.status === "none"
          ? { outcome: "none" as const, candidate: null, evidenceItems: [] }
          : {
              outcome: "eligible" as const,
              candidate: selected.candidate,
              evidenceItems: selected.evidenceItems,
            };
      const stored = await options.workspace.putArtifact({
        runId: context.runId,
        stage: "score",
        configurationFingerprint: scoreConfigurationFingerprint,
        parentOutputReferences: parents,
        artifact: { kind: "topic_selection", value: workspaceValue },
      });
      return selected.status === "none"
        ? {
            outcome: "withheld",
            reason: "NO_ELIGIBLE_TOPIC",
            inputFingerprint: expectedInput,
            outputReference: stored.outputReference,
            usage: EMPTY_USAGE,
          }
        : {
            outcome: "succeeded",
            inputFingerprint: expectedInput,
            outputReference: stored.outputReference,
            usage: EMPTY_USAGE,
          };
    },
  };

  const generationParent = async (runId: string) => {
    const collected = await getParent(
      runId,
      "collect",
      "news_ingestion",
      collectConfigurationFingerprint,
      [],
    );
    return getParent(
      runId,
      "score",
      "topic_selection",
      scoreConfigurationFingerprint,
      [collected.outputReference],
    );
  };

  const generate: DailyStageDefinition = {
    stage: "generate",
    inputFingerprint: null,
    resolveInputFingerprint: async ({ runId }) => {
      const parent = await generationParent(runId);
      return inputFingerprint(generationConfigurationFingerprint, [
        parent.outputReference,
      ]);
    },
    canRecoverInterrupted: async ({ runId }) => {
      const parent = await generationParent(runId);
      return (
        (await exactArtifact({
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
      // Attempt 2 exists only to reuse an artifact persisted before a crash.
      maxAttempts: 2,
      initialDelayMs: 0,
      multiplier: 1,
      maxDelayMs: 0,
      timeoutMs: Math.min(
        900_000,
        Math.max(
          5_000,
          (options.generation?.budget.maxCallSeconds ?? 1) *
            (options.generation?.budget.maxModelCalls ?? 1) *
            1_000 +
            5_000,
        ),
      ),
    },
    validateOutputReference: async (reference) => {
      if (
        !(await options.workspace.validateOutputReference(reference, {
          stage: "generate",
          kind: "post_generation",
        })) ||
        reference === null
      ) {
        return false;
      }
      const metadata = await options.workspace.getArtifactMetadata(reference);
      return metadata.configurationFingerprint === generationConfigurationFingerprint;
    },
    execute: async (context) => {
      const selected = await generationParent(context.runId);
      const parents = [selected.outputReference];
      const expectedInput = inputFingerprint(
        generationConfigurationFingerprint,
        parents,
      );
      const existing = await exactArtifact({
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
      if (selected.artifact.kind !== "topic_selection") {
        throw new DailyStepError("INVALID_SOURCE_DATA", false, {
          usage: EMPTY_USAGE,
        });
      }
      if (
        selected.artifact.value.outcome !== "eligible" ||
        selected.artifact.value.candidate === null
      ) {
        throw new DailyStepError("INVALID_SOURCE_DATA", false, {
          usage: EMPTY_USAGE,
        });
      }
      if (!options.generation && !storedResult) {
        // No draft is requested until a provider and an independent evaluator
        // are explicitly configured. This path performs zero model calls.
        throw new DailyStepError("INVALID_SOURCE_DATA", false, {
          usage: EMPTY_USAGE,
        });
      }
      const selectedValue = selected.artifact.value;
      const selectedEvidenceItems = selectedValue.evidenceItems;
      const selectedCandidate = selectedValue.candidate!;
      const postGeneration =
        storedResult?.value ??
        (await (async () => {
          const articleDocuments =
            options.generation!.articleDocumentsForEvidence?.(
              selectedEvidenceItems,
            ) ?? [];
          return runPostGeneration({
            provider: options.generation!.provider,
            semanticEvaluator: options.generation!.semanticEvaluator,
            evidenceItems: selectedEvidenceItems,
            articleDocuments,
            evidencePolicy: selectedCandidate.evidencePolicy,
            budget: options.generation!.budget,
            abortSignal: context.signal,
          });
        })());
      const mapping = mapPostGenerationForDailyStage(postGeneration);
      if (mapping.disposition === "failed") {
        // Provider failures are not persisted without a fenced call ledger.
        throw new DailyStepError(mapping.errorCode, false, {
          usage: generationUsage(mapping.usage),
        });
      }
      const stored =
        existing ??
        (await options.workspace.putArtifact({
          runId: context.runId,
          stage: "generate",
          configurationFingerprint: generationConfigurationFingerprint,
          parentOutputReferences: parents,
          artifact: { kind: "post_generation", value: postGeneration },
        }));
      const outputReference = stored.outputReference;
      if (mapping.disposition === "ready") {
        return {
          outcome: "succeeded",
          inputFingerprint: expectedInput,
          outputReference,
          usage: generationUsage(mapping.usage),
        };
      }
      return {
        outcome: "withheld",
        reason: mapping.reason,
        inputFingerprint: expectedInput,
        outputReference,
        usage: generationUsage(mapping.usage),
      };
    },
  };

  return [collect, score, generate];
}

export async function runMemoryDailyPipeline(
  options: Readonly<RunMemoryDailyPipelineOptions>,
) {
  const stages = createMemoryDailyStages(options);
  const minimumLeaseDurationMs = Math.max(
    ...stages.map((stage) => stage.retryPolicy.timeoutMs + 1_000),
    ...stages.map((stage) => stage.retryPolicy.maxDelayMs + 1_000),
  );
  return runDailyPipeline({
    ...options,
    // Composite generation can contain up to four bounded model calls.
    leaseDurationMs: options.leaseDurationMs ?? minimumLeaseDurationMs,
    stages,
  });
}
