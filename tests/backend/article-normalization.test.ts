import { describe, expect, it } from "vitest";

import type { ArticleInput, NormalizedArticle } from "../../src/contracts";
import { deduplicateArticles } from "../../src/pipeline/deduplicate";
import {
  canonicalizeArticleUrl,
  normalizeArticle,
  normalizeArticleTitle,
} from "../../src/pipeline/normalize";
import { RSS_SOURCE_REGISTRY } from "../../src/pipeline/collectors";
import { MemoryArticleRepository } from "../../src/repositories/article-memory.repository";

const source = RSS_SOURCE_REGISTRY[0];

function articleInput(overrides: Partial<ArticleInput> = {}): ArticleInput {
  return {
    sourceId: source.sourceId,
    externalId: "press-1",
    originalUrl:
      "https://www.msit.go.kr/press/view.do?b=2&utm_source=rss&a=1#content",
    title: "AI·디지털  교육 정책",
    excerpt: "초등학교 관련 요약",
    author: null,
    publisher: source.name,
    publishedAt: "2026-08-12T09:00:00+09:00",
    publishedAtPrecision: "instant",
    discoveredAt: "2026-08-12T09:05:00+09:00",
    ...overrides,
  };
}

describe("기사 정규화", () => {
  it("추적 파라미터와 fragment를 제거하고 query를 정렬한다", () => {
    expect(
      canonicalizeArticleUrl(
        "https://www.msit.go.kr/press/view.do?b=2&utm_medium=email&a=3&a=1&fbclid=x#top",
      ),
    ).toBe("https://www.msit.go.kr/press/view.do?a=1&a=3&b=2");
  });

  it("Unicode·대소문자·구두점을 결정론적으로 정규화한다", () => {
    expect(normalizeArticleTitle("ＡＩ·Digital—교육!!")).toBe("ai digital 교육");
  });

  it("같은 입력에 같은 URL 해시·지문·기사 ID·출처 그룹키를 만든다", () => {
    const first = normalizeArticle(articleInput(), source);
    const second = normalizeArticle(articleInput(), source);

    expect(first).toEqual(second);
    expect(first.articleId).toBe(`article:${first.canonicalUrlHash}`);
    expect(first.provenanceGroupKey).toMatch(/^msit:[a-f0-9]{32}$/);
    expect(first.canonicalizationVersion).toBe("canonical-url-v1");
    expect(first.fingerprintVersion).toBe("content-fingerprint-v1");
  });
});

describe("기사 중복 제거와 멱등 저장", () => {
  it("정규 URL과 제목 지문의 연결된 중복까지 하나로 묶는다", () => {
    const first = normalizeArticle(articleInput(), source);
    const sameUrl = normalizeArticle(
      articleInput({
        externalId: "press-2",
        originalUrl: "https://www.msit.go.kr/press/view.do?a=1&b=2",
        title: "다른 제목",
        publishedAt: "2026-08-12T10:00:00+09:00",
      }),
      source,
    );
    const sameTitle = normalizeArticle(
      articleInput({
        externalId: "press-3",
        originalUrl: "https://www.msit.go.kr/press/another.do",
        title: "AI 디지털 교육 정책!",
        publishedAt: "2026-08-12T11:00:00+09:00",
      }),
      source,
    );

    const unique = deduplicateArticles([first, sameTitle, sameUrl]);
    expect(unique).toHaveLength(1);
    expect(unique[0].articleId).toBe(sameTitle.articleId);
  });

  it("입력 순서와 관계없이 같은 대표 기사를 선택한다", () => {
    const older = normalizeArticle(articleInput(), source);
    const newer = normalizeArticle(
      articleInput({
        externalId: "press-newer",
        originalUrl: "https://www.msit.go.kr/press/newer.do",
        publishedAt: "2026-08-13T09:00:00+09:00",
      }),
      source,
    );

    expect(deduplicateArticles([older, newer])).toEqual([newer]);
    expect(deduplicateArticles([newer, older])).toEqual([newer]);
  });

  it("같은 기사를 반복 저장해도 저장 건수가 늘지 않는다", async () => {
    const repository = new MemoryArticleRepository();
    const article = normalizeArticle(articleInput(), source);

    await expect(repository.upsertMany([article])).resolves.toEqual({
      insertedCount: 1,
      duplicateCount: 0,
      totalCount: 1,
    });
    await expect(repository.upsertMany([article, article])).resolves.toEqual({
      insertedCount: 0,
      duplicateCount: 2,
      totalCount: 1,
    });
    await expect(repository.count()).resolves.toBe(1);

    const returned = await repository.findById(article.articleId);
    expect(returned).not.toBeNull();
    if (returned) {
      returned.title = "외부에서 변경";
    }
    expect((await repository.findById(article.articleId))?.title).toBe(article.title);
  });

  it("잘못된 배치는 부분 저장하지 않는다", async () => {
    const repository = new MemoryArticleRepository();
    const article = normalizeArticle(articleInput(), source);
    const invalid = { ...article, canonicalUrlHash: "invalid" } as NormalizedArticle;

    await expect(repository.upsertMany([article, invalid])).rejects.toThrow();
    await expect(repository.count()).resolves.toBe(0);
  });
});
