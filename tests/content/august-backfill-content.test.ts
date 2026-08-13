import { describe, expect, it } from "vitest";

import {
  evidenceItemSchema,
  generatedPostSchema,
  graphemeLength,
  sourceRegistryEntrySchema,
  type EvidenceItem,
  type SourceCollectionOutcome,
} from "../../src/contracts";
import { RSS_SOURCE_REGISTRY } from "../../src/pipeline/collectors";
import {
  runNewsIngestion,
  selectDailyTopic,
} from "../../src/pipeline/orchestrator";
import {
  runSemanticQualityGate,
  validateGeneratedPost,
} from "../../src/pipeline/quality";
import { MemoryArticleRepository } from "../../src/repositories/article-memory.repository";
import {
  AUGUST_2026_BACKFILL_TOPICS,
  buildBackfillGeneratedPost,
} from "../../scripts/backfill-2026-08-content";

function evidencePair(topicIndex: number): readonly [EvidenceItem, EvidenceItem] {
  const topic = AUGUST_2026_BACKFILL_TOPICS[topicIndex];
  if (topic === undefined) {
    throw new Error("BACKFILL_TOPIC_REQUIRED");
  }
  return topic.sources.map((source, sourceIndex) => {
    const suffix = String(topicIndex * 2 + sourceIndex + 1).padStart(2, "0");
    return evidenceItemSchema.parse({
      evidenceId: "backfill-evidence-" + suffix,
      articleId: "backfill-article-" + suffix,
      passageId: "backfill-passage-" + suffix,
      passageHash: (sourceIndex === 0 ? "a" : "b").repeat(64),
      sourceId: "backfill-source-" + suffix,
      publisherGroupId: "backfill-publisher-" + suffix,
      provenanceGroupKey: "backfill-provenance-" + suffix,
      sourceRole: source.sourceRole,
      sourceType: source.sourceType,
      authority: "none",
      sourceName: source.publisher,
      title: source.documentTitle,
      url: source.url,
      publishedAt: source.publishedAt,
      publishedAtPrecision: "date",
      passage: source.passage,
      locator: "운영자 검토 요약",
    });
  }) as unknown as readonly [EvidenceItem, EvidenceItem];
}

describe("approved August 2026 backfill content", () => {
  it("covers every date from August 1 through August 12 exactly once", () => {
    expect(AUGUST_2026_BACKFILL_TOPICS).toHaveLength(12);
    expect(AUGUST_2026_BACKFILL_TOPICS.map((topic) => topic.runDate)).toEqual(
      Array.from({ length: 12 }, (_, index) =>
        "2026-08-" + String(index + 1).padStart(2, "0"),
      ),
    );
  });

  it("uses two distinct HTTPS sources and keeps public copy within product limits", () => {
    for (const topic of AUGUST_2026_BACKFILL_TOPICS) {
      expect(new Set(topic.sources.map((source) => source.url)).size).toBe(2);
      expect(topic.sources.every((source) => source.url.startsWith("https://"))).toBe(
        true,
      );
      expect(topic.sources.map((source) => source.sourceRole)).toEqual([
        "primary",
        "independent",
      ]);
      expect(graphemeLength(topic.title)).toBeLessThanOrEqual(36);
      expect(graphemeLength(topic.summary)).toBeLessThanOrEqual(100);
      expect(graphemeLength(topic.question)).toBeLessThanOrEqual(80);
    }
  });

  it("passes the structural and deterministic semantic quality gates for all 12 posts", () => {
    AUGUST_2026_BACKFILL_TOPICS.forEach((topic, index) => {
      const evidenceItems = evidencePair(index);
      const post = generatedPostSchema.parse(
        buildBackfillGeneratedPost(topic, evidenceItems),
      );
      const structural = validateGeneratedPost({
        post,
        evidenceItems,
        evidencePolicy: "primary_plus_independent",
      });
      const semantic = runSemanticQualityGate({
        post,
        evidenceItems,
        evaluatorReview: {
          passed: true,
          evaluatorVersion: "curated-semantic-v1",
          findings: [],
        },
      });

      expect(structural, topic.runDate).toMatchObject({ passed: true });
      expect(semantic.qualityResult, topic.runDate).toMatchObject({
        passed: true,
      });
    });
  });

  it("selects every curated date before any persistent backfill mutation", async () => {
    const baseSource = RSS_SOURCE_REGISTRY[0];

    for (const topic of AUGUST_2026_BACKFILL_TOPICS) {
      const sources = topic.sources.map((source, index) => {
        const sourceId =
          "preflight-" + topic.runDate.replaceAll("-", "") + "-" + (index + 1);
        return sourceRegistryEntrySchema.parse({
          ...baseSource,
          sourceId,
          name: source.publisher,
          publisherGroupId: sourceId,
          provenanceGroupPrefix: sourceId,
          feedUrl: source.url,
          siteUrl: new URL(source.url).origin + "/",
          publisherType: source.publisherType,
          originType: source.originType,
          sourceRole: source.sourceRole,
          sourceType: source.sourceType,
          authority: "none",
          enabled: true,
          accessStatus: "allowed",
          accessReviewedAt: "2026-08-13T00:00:00.000Z",
          policyReferenceUrls: [source.policyUrl],
        });
      });
      const outcomes = new Map<string, SourceCollectionOutcome>(
        sources.map((source, index) => {
          const document = topic.sources[index];
          if (document === undefined) throw new Error("BACKFILL_SOURCE_REQUIRED");
          return [
            source.sourceId,
            {
              sourceId: source.sourceId,
              status: "succeeded",
              startedAt: topic.runDate + "T06:00:00+09:00",
              finishedAt: topic.runDate + "T06:00:01+09:00",
              items: [
                {
                  sourceId: source.sourceId,
                  externalId: source.sourceId + "-document",
                  originalUrl: document.url,
                  title:
                    "초등 AI 디지털 교육 " +
                    topic.title +
                    " — " +
                    document.documentTitle,
                  excerpt: document.passage,
                  author: null,
                  publisher: document.publisher,
                  publishedAt: document.publishedAt,
                  publishedAtPrecision: "date",
                  discoveredAt: topic.runDate + "T06:00:00+09:00",
                },
              ],
              issues: [],
            },
          ];
        }),
      );
      const ingestion = await runNewsIngestion({
        articleRepository: new MemoryArticleRepository(),
        sources,
        collectSource: async (source) => {
          const outcome = outcomes.get(source.sourceId);
          if (outcome === undefined) throw new Error("BACKFILL_OUTCOME_REQUIRED");
          return outcome;
        },
      });
      const selected = selectDailyTopic({
        articles: ingestion.articles,
        evidenceItems: ingestion.evidenceItems,
        sources,
      });

      expect(selected.status, topic.runDate).toBe("selected");
      if (selected.status === "selected") {
        expect(selected.candidate.evidencePolicy, topic.runDate).toBe(
          "primary_plus_independent",
        );
        expect(selected.evidenceItems, topic.runDate).toHaveLength(2);
      }
    }
  });
});
