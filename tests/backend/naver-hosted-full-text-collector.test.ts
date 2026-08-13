import { describe, expect, it, vi } from "vitest";

import type { NormalizedArticle } from "../../src/contracts";
import {
  collectNaverHostedArticleFullText,
  FullTextCollectionError,
  type FullTextSourcePolicy,
} from "../../src/pipeline/collectors";

const hostedUrl = "https://n.news.naver.com/mnews/article/001/0012345678";
const article: NormalizedArticle = {
  sourceId: "naver-news-yonhap",
  externalId: "0012345678",
  originalUrl: "https://www.yna.co.kr/view/AKR20260812000100004",
  hostedArticleUrl: hostedUrl,
  title: "AI 디지털 교육 기사",
  excerpt: null,
  author: null,
  publisher: "연합뉴스",
  publishedAt: "2026-08-12T09:00:00+09:00",
  publishedAtPrecision: "instant",
  discoveredAt: "2026-08-12T10:00:00+09:00",
  articleId: "article-1",
  publisherGroupId: "yonhap",
  provenanceGroupKey: "naver-search:yonhap:0012345678",
  canonicalUrl: "https://www.yna.co.kr/view/AKR20260812000100004",
  canonicalUrlHash: "a".repeat(64),
  normalizedTitle: "ai 디지털 교육 기사",
  contentFingerprint: "b".repeat(64),
  canonicalizationVersion: "v1",
  fingerprintVersion: "v1",
  originType: "wire",
};

const policy: FullTextSourcePolicy = {
  sourceId: article.sourceId,
  fullTextUseAllowed: true,
  allowedOrigins: ["https://n.news.naver.com"],
  accessReviewedAt: "2026-08-13T00:00:00+09:00",
  policyReferenceUrls: ["https://policy.example/full-text-review"],
  retentionDays: 30,
  timeoutMs: 5_000,
  maxResponseBytes: 100_000,
  maxTextCharacters: 20_000,
  maxRedirects: 1,
  notes: "공개 Naver hosted 기사 본문 이용 조건을 별도로 검토한 테스트 정책",
};
const policyRegistry = new Map([[article.sourceId, policy]]);

const publicLookup = vi.fn(async () => [
  { address: "223.130.200.104", family: 4 as const },
]);

function longBody(): string {
  return Array.from(
    { length: 45 },
    (_, index) => `<p>${index + 1}번째 문단입니다. AI 디지털 교육 정책과 학생의 경험을 설명하는 충분히 긴 국내 기사 본문입니다.</p>`,
  ).join("");
}

function fetchFixture(options: { robots?: string; html?: string; contentType?: string } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    expect(init?.redirect).toBe("manual");
    if (url.pathname === "/robots.txt") {
      return new Response(options.robots ?? "User-agent: *\nAllow: /mnews/article/", {
        headers: { "content-type": "text/plain" },
      });
    }
    return new Response(
      options.html ?? `<html><div id="dic_area"><div>${longBody()}</div></div></html>`,
      { headers: { "content-type": options.contentType ?? "text/html; charset=utf-8" } },
    );
  }) as unknown as typeof fetch;
}

describe("Naver hosted 공개 기사 원문 수집", () => {
  it("robots 허용 후 #dic_area 본문만 추출하고 권한·보존 메타데이터를 남긴다", async () => {
    const result = await collectNaverHostedArticleFullText(
      { article, hostedArticleUrl: hostedUrl, policyRegistry },
      {
        fetch: fetchFixture(),
        lookup: publicLookup,
        now: () => new Date("2026-08-13T00:00:00.000Z"),
      },
    );

    expect(result).toMatchObject({
      articleId: "article-1",
      sourceId: "naver-news-yonhap",
      canonicalUrl: article.canonicalUrl,
      finalUrl: hostedUrl,
      collectedAt: "2026-08-13T00:00:00.000Z",
      retentionUntil: "2026-09-12T00:00:00.000Z",
      permission: { fullTextUseAllowed: true },
    });
    expect(result.bodyText).toContain("AI 디지털 교육 정책");
    expect(result.bodyText).not.toContain("<p>");
    expect(result.bodySha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("Naver hosted allowlist 밖 주소는 네트워크 요청 전에 거부한다", async () => {
    const fetchMock = fetchFixture();
    await expect(
      collectNaverHostedArticleFullText(
        {
          article,
          hostedArticleUrl: "https://www.yna.co.kr/view/AKR20260812000100004",
          policyRegistry,
        },
        { fetch: fetchMock, lookup: publicLookup },
      ),
    ).rejects.toMatchObject({ code: "FULL_TEXT_NOT_ALLOWED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("robots 차단, 로그인·유료 벽과 비HTML 응답을 fail-closed 처리한다", async () => {
    const cases: Array<{ fetch: typeof fetch; code: FullTextCollectionError["code"] }> = [
      {
        fetch: fetchFixture({ robots: "User-agent: *\nDisallow: /mnews/article/" }),
        code: "ROBOTS_DISALLOWED",
      },
      {
        fetch: fetchFixture({ html: `<form id="login">로그인 후 이용 ${longBody()}</form>` }),
        code: "AUTHENTICATION_REQUIRED",
      },
      {
        fetch: fetchFixture({ html: `<div class="paywall">유료 구독자만 ${longBody()}</div>` }),
        code: "PAYWALL_DETECTED",
      },
      {
        fetch: fetchFixture({ contentType: "application/pdf" }),
        code: "UNSUPPORTED_CONTENT_TYPE",
      },
    ];
    for (const item of cases) {
      await expect(
        collectNaverHostedArticleFullText(
          { article, hostedArticleUrl: hostedUrl, policyRegistry },
          { fetch: item.fetch, lookup: publicLookup },
        ),
      ).rejects.toMatchObject({ code: item.code });
    }
  });

  it("본문이 없거나 설정된 글자 상한을 넘으면 저장 후보를 만들지 않는다", async () => {
    await expect(
      collectNaverHostedArticleFullText(
        { article, hostedArticleUrl: hostedUrl, policyRegistry },
        { fetch: fetchFixture({ html: "<html><p>본문 없음</p></html>" }), lookup: publicLookup },
      ),
    ).rejects.toMatchObject({ code: "ARTICLE_BODY_NOT_FOUND" });

    await expect(
      collectNaverHostedArticleFullText(
        {
          article,
          hostedArticleUrl: hostedUrl,
          policyRegistry: new Map([
            [article.sourceId, { ...policy, maxTextCharacters: 1_000 }],
          ]),
        },
        { fetch: fetchFixture(), lookup: publicLookup },
      ),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("등록부가 비어 있으면 robots 요청 전에도 원문 수집을 차단한다", async () => {
    const fetchMock = fetchFixture();
    await expect(
      collectNaverHostedArticleFullText(
        { article, hostedArticleUrl: hostedUrl },
        { fetch: fetchMock, lookup: publicLookup },
      ),
    ).rejects.toMatchObject({ code: "FULL_TEXT_NOT_ALLOWED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("가장 구체적인 robots 사용자 에이전트와 wildcard 규칙을 따른다", async () => {
    await expect(
      collectNaverHostedArticleFullText(
        { article, hostedArticleUrl: hostedUrl, policyRegistry },
        {
          fetch: fetchFixture({
            robots:
              "User-agent: *\nAllow: /mnews/article/*\n\nUser-agent: AI-Education-Today-FullText-Collector\nDisallow: /mnews/article/*$",
          }),
          lookup: publicLookup,
        },
      ),
    ).rejects.toMatchObject({ code: "ROBOTS_DISALLOWED" });
  });
});
