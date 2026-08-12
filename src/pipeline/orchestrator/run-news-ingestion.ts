import type {
  EvidenceItem,
  NormalizedArticle,
  SourceCollectionOutcome,
  SourceRegistryEntry,
} from "../../contracts";
import { sourceCollectionOutcomeSchema } from "../../contracts";
import type { ArticleUpsertResult } from "../../repositories/article-memory.repository";
import { collectRssSource, RSS_SOURCE_REGISTRY } from "../collectors";
import { deduplicateArticles } from "../deduplicate";
import { normalizeArticle } from "../normalize";
import { createRssExcerptEvidenceItem } from "../retrieval";
import {
  deriveTopicSignals,
  evaluateTopicScoreThresholds,
  scoreTopicSignals,
  type TopicSignals,
  type TopicThresholdResult,
} from "../scoring";

export interface IngestedArticleRepository {
  upsertMany(
    articles: Parameters<typeof deduplicateArticles>[0],
  ): Promise<ArticleUpsertResult>;
}

export interface NewsCandidateAssessment {
  articleId: string;
  evidenceIds: string[];
  signals: TopicSignals;
  score: ReturnType<typeof scoreTopicSignals>;
  threshold: TopicThresholdResult;
}

export interface NewsIngestionResult {
  status: "succeeded" | "partial" | "failed";
  outcomes: SourceCollectionOutcome[];
  collectedCount: number;
  normalizedCount: number;
  deduplicatedCount: number;
  storage: ArticleUpsertResult;
  articles: NormalizedArticle[];
  evidenceItems: EvidenceItem[];
  candidates: NewsCandidateAssessment[];
  runIssues: Array<{
    code: "NO_ENABLED_SOURCE";
    message: string;
  }>;
}

export interface RunNewsIngestionOptions {
  articleRepository: IngestedArticleRepository;
  sources?: readonly SourceRegistryEntry[];
  collectSource?: (
    source: SourceRegistryEntry,
    signal?: AbortSignal,
  ) => Promise<SourceCollectionOutcome>;
  abortSignal?: AbortSignal;
  previousPostTitles?: readonly string[];
  previousContentFingerprints?: readonly string[];
}

export class NewsIngestionAbortedError extends Error {
  constructor() {
    super("뉴스 수집 실행이 중단되었습니다.");
    this.name = "NewsIngestionAbortedError";
  }
}

function deriveRunStatus(
  outcomes: readonly SourceCollectionOutcome[],
  deduplicatedCount: number,
): NewsIngestionResult["status"] {
  const failedCount = outcomes.filter(
    (outcome) => outcome.status === "failed",
  ).length;
  if (deduplicatedCount === 0 && failedCount === outcomes.length) {
    return "failed";
  }
  return failedCount > 0 || outcomes.some((outcome) => outcome.status === "partial")
    ? "partial"
    : "succeeded";
}

function failedCollectionOutcome(
  sourceId: string,
  startedAt: string,
  message: string,
): SourceCollectionOutcome {
  return sourceCollectionOutcomeSchema.parse({
    sourceId,
    status: "failed",
    startedAt,
    finishedAt: new Date().toISOString(),
    items: [],
    issues: [
      {
        code: "INVALID_SOURCE_DATA",
        message,
        retryable: false,
        itemIndex: null,
      },
    ],
  });
}

async function collectIsolated(
  source: SourceRegistryEntry,
  collectSource: NonNullable<RunNewsIngestionOptions["collectSource"]>,
  abortSignal?: AbortSignal,
): Promise<SourceCollectionOutcome> {
  if (abortSignal?.aborted) throw new NewsIngestionAbortedError();
  const startedAt = new Date().toISOString();
  try {
    const parsed = sourceCollectionOutcomeSchema.safeParse(
      await collectSource(source, abortSignal),
    );
    if (abortSignal?.aborted) throw new NewsIngestionAbortedError();
    if (!parsed.success || parsed.data.sourceId !== source.sourceId) {
      return failedCollectionOutcome(
        source.sourceId,
        startedAt,
        "수집기가 요청한 수집원과 일치하는 유효한 결과를 반환하지 않았습니다.",
      );
    }
    return parsed.data;
  } catch (error) {
    if (abortSignal?.aborted || error instanceof NewsIngestionAbortedError) {
      throw new NewsIngestionAbortedError();
    }
    return failedCollectionOutcome(
      source.sourceId,
      startedAt,
      "수집기 예외를 해당 수집원의 실패로 격리했습니다.",
    );
  }
}

/**
 * Executes the database-independent M2 flow. Source failures are returned as
 * data, while usable sources continue through normalization and candidate
 * assessment. Nothing in this function publishes a post.
 */
export async function runNewsIngestion(
  options: RunNewsIngestionOptions,
): Promise<NewsIngestionResult> {
  if (options.abortSignal?.aborted) throw new NewsIngestionAbortedError();
  const sources = (options.sources ?? RSS_SOURCE_REGISTRY).filter(
    (source) => source.enabled,
  );
  if (sources.length === 0) {
    const storage = await options.articleRepository.upsertMany([]);
    return {
      status: "failed",
      outcomes: [],
      collectedCount: 0,
      normalizedCount: 0,
      deduplicatedCount: 0,
      storage,
      articles: [],
      evidenceItems: [],
      candidates: [],
      runIssues: [
        {
          code: "NO_ENABLED_SOURCE",
          message: "활성화된 뉴스 수집원이 없습니다.",
        },
      ],
    };
  }
  const collectSource =
    options.collectSource ??
    ((source: SourceRegistryEntry, signal?: AbortSignal) =>
      collectRssSource(source, { signal }));
  const outcomes = await Promise.all(
    sources.map((source) =>
      collectIsolated(source, collectSource, options.abortSignal),
    ),
  );
  if (options.abortSignal?.aborted) throw new NewsIngestionAbortedError();
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  const collected = outcomes.flatMap((outcome) => outcome.items);
  const normalized = collected.map((article) => {
    const source = sourceById.get(article.sourceId);
    if (!source) {
      throw new Error(`등록되지 않은 수집원 결과입니다: ${article.sourceId}`);
    }
    return normalizeArticle(article, source);
  });
  const deduplicated = deduplicateArticles(normalized);
  const storage = await options.articleRepository.upsertMany(deduplicated);
  const evidenceItems: EvidenceItem[] = [];
  const candidates = deduplicated.map((article) => {
    const source = sourceById.get(article.sourceId);
    if (!source) {
      throw new Error(`등록되지 않은 정규화 기사입니다: ${article.sourceId}`);
    }
    const signals = deriveTopicSignals({
      articles: [article],
      sourceRegistryEntries: [source],
      previousPostTitles: options.previousPostTitles,
      previousContentFingerprints: options.previousContentFingerprints,
    });
    const score = scoreTopicSignals(signals);
    const evidence = createRssExcerptEvidenceItem(article, source);
    if (evidence) {
      evidenceItems.push(evidence);
    }
    return {
      articleId: article.articleId,
      evidenceIds: evidence ? [evidence.evidenceId] : [],
      signals,
      score,
      threshold: evaluateTopicScoreThresholds(score),
    };
  });

  return {
    status: deriveRunStatus(outcomes, deduplicated.length),
    outcomes,
    collectedCount: collected.length,
    normalizedCount: normalized.length,
    deduplicatedCount: deduplicated.length,
    storage,
    articles: structuredClone(deduplicated),
    evidenceItems: structuredClone(evidenceItems),
    candidates,
    runIssues: [],
  };
}
