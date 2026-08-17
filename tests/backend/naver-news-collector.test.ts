import { describe, expect, it, vi } from "vitest";

import {
  collectNaverNewsSources,
  createNaverPublisherSources,
  NAVER_NEWS_QUERIES,
} from "../../src/pipeline/collectors";
import { createRssExcerptEvidenceItem } from "../../src/pipeline/retrieval";
import { normalizeArticle } from "../../src/pipeline/normalize";

function response(items: unknown[]): Response {
  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Naver news metadata collector", () => {
  it("runs each bounded query once and separates results by original publisher", async () => {
    const fetchImpl = vi.fn(async () =>
      response([
        {
          rank: 1,
          title: "<b>초등 AI</b> 교육을 다시 묻다",
          description: "교사들이 AI의 답을 검토하는 교육을 제안했다.",
          link: "https://n.news.naver.com/article/001",
          original_link: "https://www.donga.com/news/Society/article/all/20260813/1",
          pub_date: "Thu, 13 Aug 2026 09:00:00 +0900",
          pub_date_iso: "2026-08-13T00:00:00.000Z",
          source: "naver-openapi",
        },
        {
          rank: 2,
          title: "허용되지 않은 매체",
          description: "저장하지 않는다.",
          link: "https://example.com/article",
          original_link: "https://example.com/article",
          pub_date: "Thu, 13 Aug 2026 09:00:00 +0900",
          pub_date_iso: "2026-08-13T00:00:00.000Z",
          source: "naver-openapi",
        },
      ]),
    );
    const sources = createNaverPublisherSources();
    const outcomes = await collectNaverNewsSources({
      sources,
      fetchImpl,
      now: () => new Date("2026-08-13T01:00:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(NAVER_NEWS_QUERIES.length);
    const donga = outcomes.get("naver-summary-donga");
    expect(donga?.items).toHaveLength(1);
    expect(donga?.items[0]?.title).toBe("초등 AI 교육을 다시 묻다");
    expect(donga?.items[0]?.publisher).toBe("동아일보");
    expect(donga?.items[0]?.excerpt).toBe(
      "교사들이 AI의 답을 검토하는 교육을 제안했다.",
    );
    expect(
      [...outcomes.values()].flatMap((outcome) => outcome.items),
    ).toHaveLength(1);
  });

  it("uses only API collection sources with a daily request policy", () => {
    const sources = createNaverPublisherSources();
    expect(sources.length).toBeGreaterThanOrEqual(4);
    expect(sources.every((source) => source.collectionType === "api")).toBe(true);
    expect(
      sources.every((source) => source.requestPolicy.minIntervalMs === 86_400_000),
    ).toBe(true);
    expect(sources.every((source) => source.contentUse === "evidence")).toBe(
      true,
    );
    expect(sources.some((source) => source.sourceRole === "independent")).toBe(true);
    expect(
      sources.every((source) =>
        ["wire", "original_reporting"].includes(source.originType),
      ),
    ).toBe(true);
  });

  it("turns only the official API summary into bounded evidence", () => {
    const source = createNaverPublisherSources().find(
      (candidate) => candidate.sourceId === "naver-summary-donga",
    );
    expect(source).toBeDefined();
    const article = normalizeArticle(
      {
        sourceId: source!.sourceId,
        externalId: "naver-test",
        originalUrl: "https://www.donga.com/news/It/article/all/20260813/1",
        title: "AI 에이전트가 개인정보 판단에 미치는 변화",
        excerpt:
          "AI 에이전트가 개인정보를 다루는 방식과 자동화된 판단의 책임을 둘러싼 논의가 이어지고 있다.",
        author: null,
        publisher: source!.name,
        publishedAt: "2026-08-13T00:00:00.000Z",
        publishedAtPrecision: "instant",
        discoveredAt: "2026-08-13T01:00:00.000Z",
      },
      source!,
    );

    expect(createRssExcerptEvidenceItem(article, source!)).toMatchObject({
      locator: "뉴스 검색 API 요약",
      passage:
        "AI 에이전트가 개인정보를 다루는 방식과 자동화된 판단의 책임을 둘러싼 논의가 이어지고 있다.",
    });
  });

  it("isolates every query failure instead of failing the whole batch", async () => {
    const fetchImpl = vi.fn(async () => new Response("quota", { status: 429 }));
    const outcomes = await collectNaverNewsSources({
      sources: createNaverPublisherSources(),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(NAVER_NEWS_QUERIES.length);
    for (const outcome of outcomes.values()) {
      expect(outcome.status).toBe("failed");
      expect(outcome.items).toHaveLength(0);
      expect(outcome.issues.length).toBeGreaterThan(0);
      expect(outcome.issues[0]?.code).toBe("SOURCE_UNAVAILABLE");
      expect(outcome.issues[0]?.message).toContain("429");
    }
  });

  it("keeps items from queries that succeed when one query fails (partial)", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("quota", { status: 429 });
      return response([
        {
          rank: 1,
          title: "AI 정책 관련 기사",
          description: "정책 관련 설명입니다.",
          link: "https://n.news.naver.com/article/002",
          original_link: "https://www.donga.com/news/Society/article/all/20260813/2",
          pub_date: "Thu, 13 Aug 2026 09:00:00 +0900",
          pub_date_iso: "2026-08-13T00:00:00.000Z",
          source: "naver-openapi",
        },
      ]);
    });
    const outcomes = await collectNaverNewsSources({
      sources: createNaverPublisherSources(),
      fetchImpl,
      now: () => new Date("2026-08-13T01:00:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(NAVER_NEWS_QUERIES.length);
    const donga = outcomes.get("naver-summary-donga");
    expect(donga?.status).toBe("partial");
    expect(donga?.items.length).toBeGreaterThan(0);
    expect(donga?.issues.length).toBeGreaterThan(0);
  });

  it("aborts the whole batch immediately when the outer signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => response([]));
    await expect(
      collectNaverNewsSources({
        sources: createNaverPublisherSources(),
        fetchImpl,
        signal: controller.signal,
      }),
    ).resolves.toBeInstanceOf(Map);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
