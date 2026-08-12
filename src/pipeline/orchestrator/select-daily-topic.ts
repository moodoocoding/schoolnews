import { createHash } from "node:crypto";

import {
  topicCandidateSchema,
  type EvidenceItem,
  type NormalizedArticle,
  type SourceRegistryEntry,
  type TopicCandidate,
} from "../../contracts";
import {
  deriveTopicSignals,
  evaluateTopicScoreThresholds,
  scoreTopicSignals,
} from "../scoring";

export const DAILY_TOPIC_SELECTION_VERSION = "daily-topic-selection-v1";
export const RELATED_TITLE_SIMILARITY_THRESHOLD = 0.42;

export type DailyTopicSelectionResult =
  | {
      status: "selected";
      candidate: TopicCandidate;
      evidenceItems: EvidenceItem[];
      assessedGroupCount: number;
      selectionVersion: typeof DAILY_TOPIC_SELECTION_VERSION;
    }
  | {
      status: "none";
      candidate: null;
      evidenceItems: [];
      assessedGroupCount: number;
      selectionVersion: typeof DAILY_TOPIC_SELECTION_VERSION;
    };

export interface SelectDailyTopicInput {
  articles: readonly NormalizedArticle[];
  evidenceItems: readonly EvidenceItem[];
  sources: readonly SourceRegistryEntry[];
  previousPostTitles?: readonly string[];
  previousContentFingerprints?: readonly string[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function titleBigrams(value: string): Set<string> {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
  if (normalized.length < 2) {
    return new Set(normalized ? [normalized] : []);
  }
  return new Set(
    Array.from({ length: normalized.length - 1 }, (_, index) =>
      normalized.slice(index, index + 2),
    ),
  );
}

function titleSimilarity(left: string, right: string): number {
  const leftBigrams = titleBigrams(left);
  const rightBigrams = titleBigrams(right);
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0;
  const intersection = [...leftBigrams].filter((item) =>
    rightBigrams.has(item),
  ).length;
  return (2 * intersection) / (leftBigrams.size + rightBigrams.size);
}

function groupRelatedArticles(
  articles: readonly NormalizedArticle[],
): NormalizedArticle[][] {
  const sorted = [...articles].sort(
    (left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
      left.articleId.localeCompare(right.articleId, "en"),
  );
  const groups: NormalizedArticle[][] = [];
  for (const article of sorted) {
    const group = groups.find((candidate) =>
      candidate.every(
        (member) =>
          titleSimilarity(member.normalizedTitle, article.normalizedTitle) >=
          RELATED_TITLE_SIMILARITY_THRESHOLD,
      ),
    );
    if (group) group.push(article);
    else groups.push([article]);
  }
  return groups;
}

function uniqueById<T extends { sourceId: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((item) => [item.sourceId, item])).values()];
}

function buildCandidate(input: {
  articles: readonly NormalizedArticle[];
  evidenceItems: readonly EvidenceItem[];
  sources: readonly SourceRegistryEntry[];
  previousPostTitles: readonly string[];
  previousContentFingerprints: readonly string[];
}): { candidate: TopicCandidate; evidenceItems: EvidenceItem[] } | null {
  const articleIds = new Set(input.articles.map((article) => article.articleId));
  const evidenceItems = input.evidenceItems
    .filter((item) => articleIds.has(item.articleId))
    .sort(
      (left, right) =>
        left.evidenceId.localeCompare(right.evidenceId, "en") ||
        left.articleId.localeCompare(right.articleId, "en"),
    );
  if (evidenceItems.length === 0) return null;

  const sourceIds = new Set(input.articles.map((article) => article.sourceId));
  const sources = uniqueById(
    input.sources.filter((source) => sourceIds.has(source.sourceId)),
  );
  if (sources.length !== sourceIds.size) return null;

  const score = scoreTopicSignals(
    deriveTopicSignals({
      articles: input.articles,
      sourceRegistryEntries: sources,
      previousPostTitles: input.previousPostTitles,
      previousContentFingerprints: input.previousContentFingerprints,
    }),
  );
  if (!evaluateTopicScoreThresholds(score).passed) return null;

  const publisherGroups = new Set(
    evidenceItems.map((item) => item.publisherGroupId),
  );
  const provenanceGroups = new Set(
    evidenceItems.map((item) => item.provenanceGroupKey),
  );
  const qualifyingGroupCount = Math.min(
    publisherGroups.size,
    provenanceGroups.size,
  );
  const hasPrimaryAndIndependent = evidenceItems.some(
    (primary) =>
      primary.sourceRole === "primary" &&
      primary.sourceType === "primary" &&
      evidenceItems.some(
        (independent) =>
          independent.sourceRole === "independent" &&
          independent.publisherGroupId !== primary.publisherGroupId &&
          independent.provenanceGroupKey !== primary.provenanceGroupKey,
      ),
  );
  const independentEvidence = evidenceItems.filter(
    (item) => item.sourceRole === "independent",
  );
  const hasTwoIndependentSources = independentEvidence.some(
    (left, leftIndex) =>
      independentEvidence.slice(leftIndex + 1).some(
        (right) =>
          left.publisherGroupId !== right.publisherGroupId &&
          left.provenanceGroupKey !== right.provenanceGroupKey,
      ),
  );
  const evidencePolicy = hasPrimaryAndIndependent
    ? "primary_plus_independent"
    : hasTwoIndependentSources
      ? "two_independent_sources"
      : null;
  if (evidencePolicy === null) return null;

  const identity = input.articles
    .map((article) => article.articleId)
    .sort()
    .join("\n");
  const evidenceIds = [...new Set(evidenceItems.map((item) => item.evidenceId))]
    .sort();
  const candidate = topicCandidateSchema.parse({
    topicId: `topic:daily:${sha256(identity).slice(0, 32)}`,
    articleIds: [...articleIds].sort(),
    evidenceIds,
    score,
    independence: {
      qualifyingGroupCount,
      hasPrimaryAndIndependent,
      passed: true,
      reasons: ["independent"],
    },
    evidencePolicy,
    evidencePolicyReason:
      evidencePolicy === "primary_plus_independent"
        ? "서로 다른 원출처의 공식 자료와 독립 보도가 함께 확인되었습니다."
        : "소유와 원출처가 다른 독립 보도 두 건 이상이 확인되었습니다.",
    newFactEvidenceIds: evidenceIds,
    selectionReason:
      "관련 기사 묶음이 주제 점수와 독립 출처 기준을 모두 충족했습니다.",
  });
  return { candidate, evidenceItems: structuredClone(evidenceItems) };
}

/**
 * Selects exactly one deterministic topic. An isolated official RSS excerpt is
 * never sufficient because RSS evidence is not an authoritative direct passage.
 */
export function selectDailyTopic(
  input: Readonly<SelectDailyTopicInput>,
): DailyTopicSelectionResult {
  const groups = groupRelatedArticles(input.articles);
  const eligible = groups.flatMap((articles) => {
    const built = buildCandidate({
      articles,
      evidenceItems: input.evidenceItems,
      sources: input.sources,
      previousPostTitles: input.previousPostTitles ?? [],
      previousContentFingerprints: input.previousContentFingerprints ?? [],
    });
    return built ? [built] : [];
  });
  eligible.sort(
    (left, right) =>
      right.candidate.score.total - left.candidate.score.total ||
      left.candidate.topicId.localeCompare(right.candidate.topicId, "en"),
  );
  const selected = eligible[0];
  return selected
    ? {
        status: "selected",
        candidate: selected.candidate,
        evidenceItems: selected.evidenceItems,
        assessedGroupCount: groups.length,
        selectionVersion: DAILY_TOPIC_SELECTION_VERSION,
      }
    : {
        status: "none",
        candidate: null,
        evidenceItems: [],
        assessedGroupCount: groups.length,
        selectionVersion: DAILY_TOPIC_SELECTION_VERSION,
      };
}
