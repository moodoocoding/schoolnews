import { describe, expect, it } from "vitest";

import { evidenceItemSchema, normalizedArticleSchema } from "../../src/contracts";
import {
  getEditorialWindowKst,
  selectEditorialWindowMaterials,
} from "../../src/pipeline/orchestrator";

function article(articleId: string, publishedAt: string) {
  return normalizedArticleSchema.parse({
    sourceId: `source-${articleId}`,
    externalId: articleId,
    originalUrl: `https://example.com/${articleId}`,
    title: `기사 ${articleId}`,
    excerpt: "AI 디지털 기술의 교육 영향을 살펴보는 기사입니다.",
    author: null,
    publisher: "테스트 매체",
    publishedAt,
    publishedAtPrecision: "date",
    discoveredAt: "2026-08-14T01:00:00+09:00",
    articleId,
    publisherGroupId: `publisher-${articleId}`,
    provenanceGroupKey: `provenance-${articleId}`,
    canonicalUrl: `https://example.com/${articleId}`,
    canonicalUrlHash: "a".repeat(64),
    normalizedTitle: `기사 ${articleId}`,
    contentFingerprint: "b".repeat(64),
    canonicalizationVersion: "test-v1",
    fingerprintVersion: "test-v1",
    originType: "primary_document",
  });
}

function evidence(articleId: string, publishedAt: string) {
  return evidenceItemSchema.parse({
    evidenceId: `evidence-${articleId}`,
    articleId,
    passageId: `passage-${articleId}`,
    passageHash: "c".repeat(64),
    sourceId: `source-${articleId}`,
    publisherGroupId: `publisher-${articleId}`,
    provenanceGroupKey: `provenance-${articleId}`,
    sourceRole: "primary",
    sourceType: "primary",
    authority: "none",
    sourceName: "테스트 매체",
    title: `기사 ${articleId}`,
    url: `https://example.com/${articleId}`,
    publishedAt,
    publishedAtPrecision: "date",
    passage: "AI 디지털 기술의 교육 영향을 생각할 수 있는 확인된 내용입니다.",
    locator: "RSS 요약",
  });
}

describe("최근 7일 편집 후보 창", () => {
  it("실행일을 제외한 직전 7개 KST 날짜를 계산한다", () => {
    expect(getEditorialWindowKst({ runDate: "2026-08-14", windowDays: 7 })).toEqual({
      startDateKst: "2026-08-07",
      endDateExclusiveKst: "2026-08-14",
    });
    expect(() => getEditorialWindowKst({ runDate: "2026-08-14", windowDays: 8 })).toThrow(
      RangeError,
    );
  });

  it("경계 안 기사와 정확히 연결된 근거만 남긴다", () => {
    const start = article("start", "2026-08-07T00:00:00+09:00");
    const end = article("end", "2026-08-13T23:59:59+09:00");
    const old = article("old", "2026-08-06T23:59:59+09:00");
    const today = article("today", "2026-08-14T00:00:00+09:00");
    const result = selectEditorialWindowMaterials({
      runDate: "2026-08-14",
      windowDays: 7,
      articles: [start, end, old, today],
      evidenceItems: [start, end, old, today].map((item) =>
        evidence(item.articleId, item.publishedAt),
      ),
    });
    expect(result.articles.map((item) => item.articleId)).toEqual(["start", "end"]);
    expect(result.evidenceItems.map((item) => item.articleId)).toEqual(["start", "end"]);
  });
});
