import { describe, expect, it } from "vitest";

import {
  evidenceItemSchema,
  normalizedArticleSchema,
} from "../../src/contracts";
import {
  getEditorialSourceDateKst,
  selectEditorialSourceDateMaterials,
} from "../../src/pipeline/orchestrator";

function article(articleId: string, publishedAt: string) {
  return normalizedArticleSchema.parse({
    sourceId: `source-${articleId}`,
    externalId: articleId,
    originalUrl: `https://example.com/${articleId}`,
    title: `기사 ${articleId}`,
    excerpt: "초등 AI 디지털 교육 기사입니다.",
    author: null,
    publisher: "테스트 매체",
    publishedAt,
    publishedAtPrecision: "date",
    discoveredAt: "2026-08-01T06:00:00+09:00",
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
    passage: "초등 AI 디지털 교육에 관한 확인된 내용입니다.",
    locator: "RSS 요약",
  });
}

describe("발행일 기준 웹 클리핑 날짜", () => {
  it("8월 1일 발행물의 편집 원문일을 7월 30일로 고정한다", () => {
    expect(getEditorialSourceDateKst("2026-08-01")).toBe("2026-07-30");
    expect(getEditorialSourceDateKst("2026-01-01")).toBe("2025-12-30");
  });

  it("정확히 D-2 KST 기사와 그 기사의 근거만 선정 단계로 보낸다", () => {
    const target = article("target", "2026-07-30T00:00:00+09:00");
    const sameInstantOutsideKst = article(
      "outside",
      "2026-07-29T14:59:59Z",
    );
    const later = article("later", "2026-07-31T00:00:00+09:00");
    const result = selectEditorialSourceDateMaterials({
      runDate: "2026-08-01",
      articles: [target, sameInstantOutsideKst, later],
      evidenceItems: [
        evidence("target", target.publishedAt),
        evidence("outside", sameInstantOutsideKst.publishedAt),
        evidence("later", later.publishedAt),
      ],
    });

    expect(result.sourceDateKst).toBe("2026-07-30");
    expect(result.articles.map((item) => item.articleId)).toEqual(["target"]);
    expect(result.evidenceItems.map((item) => item.articleId)).toEqual([
      "target",
    ]);
  });
});
