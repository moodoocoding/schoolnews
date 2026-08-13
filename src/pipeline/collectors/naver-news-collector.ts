import { createHash } from "node:crypto";

import {
  sourceCollectionOutcomeSchema,
  sourceRegistryEntrySchema,
  type SourceCollectionOutcome,
  type SourceRegistryEntry,
} from "../../contracts";

export const NAVER_NEWS_PROXY_ORIGIN = "https://k-skill-proxy.nomadamas.org";
export const NAVER_NEWS_PROXY_PATH = "/v1/naver-news/search";
export const NAVER_NEWS_QUERY_VERSION = "naver-news-query-v3";
export const NAVER_NEWS_QUERIES = Object.freeze([
  "초등 AI 디지털 교육",
  "교사 생성형 AI 교육",
  "교육부 AI 디지털 교육",
  "에듀테크 초등학교 교사",
  "AI 에이전트 개인정보 저작권",
  "아동 개인정보 AI 학교",
  "딥페이크 아동 청소년",
  "디지털 웰빙 아동 청소년",
  "AI 저작권 교육 저작권",
  "AI 접근성 교육 미디어 리터러시",
  "새로운 디지털 기술 교육 영향",
]);
export const NAVER_NEWS_MAX_ITEMS_PER_QUERY = 30;
export const NAVER_NEWS_MAX_TITLE_GRAPHEMES = 180;

const ALLOWED_PUBLISHERS = Object.freeze({
  "news.donga.com": { id: "donga", name: "동아일보", role: "independent" },
  "www.donga.com": { id: "donga", name: "동아일보", role: "independent" },
  "www.ohmynews.com": { id: "ohmynews", name: "오마이뉴스", role: "independent" },
  "news.ebs.co.kr": { id: "ebs-news", name: "EBS 뉴스", role: "independent" },
  "www.yna.co.kr": { id: "yonhap", name: "연합뉴스", role: "supporting" },
  "www.hangyo.com": { id: "hangyo", name: "한국교육신문", role: "independent" },
  "www.etnews.com": { id: "etnews", name: "전자신문", role: "independent" },
  "zdnet.co.kr": { id: "zdnet-korea", name: "지디넷코리아", role: "independent" },
  "www.bloter.net": { id: "bloter", name: "블로터", role: "independent" },
  "www.hani.co.kr": { id: "hani", name: "한겨레", role: "independent" },
  "www.khan.co.kr": { id: "khan", name: "경향신문", role: "independent" },
  "www.seoul.co.kr": { id: "seoul-news", name: "서울신문", role: "independent" },
  "www.chosun.com": { id: "chosun", name: "조선일보", role: "independent" },
  "chosun.com": { id: "chosun", name: "조선일보", role: "independent" },
  "www.newsis.com": { id: "newsis", name: "뉴시스", role: "supporting" },
} as const);

type PublisherHost = keyof typeof ALLOWED_PUBLISHERS;

type NaverItem = Readonly<{
  rank: number;
  title: string;
  description: string;
  link: string;
  original_link: string | null;
  pub_date: string;
  pub_date_iso: string;
  source: "naver-openapi";
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function publisherForUrl(value: string) {
  const url = new URL(value);
  return ALLOWED_PUBLISHERS[url.hostname.toLowerCase() as PublisherHost];
}

function normalizeOriginalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeHostedArticleUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["n.news.naver.com", "news.naver.com"].includes(
        url.hostname.toLowerCase(),
      )
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function truncate(value: string, maximum: number): string {
  const segments = Array.from(
    new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(value),
    (segment) => segment.segment,
  );
  return segments.slice(0, maximum).join("").trim();
}

function clean(value: string): string {
  return truncate(
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/&(?:nbsp|amp|quot|lt|gt);/gi, (reference) =>
        ({
          "&nbsp;": " ",
          "&amp;": "&",
          "&quot;": '"',
          "&lt;": "<",
          "&gt;": ">",
        })[reference.toLowerCase()] ?? " ",
      )
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim(),
    NAVER_NEWS_MAX_TITLE_GRAPHEMES,
  );
}

export function createNaverPublisherSources(): SourceRegistryEntry[] {
  const uniquePublishers = new Map<
    string,
    { host: string; publisher: (typeof ALLOWED_PUBLISHERS)[PublisherHost] }
  >();
  for (const [host, publisher] of Object.entries(ALLOWED_PUBLISHERS)) {
    if (!uniquePublishers.has(publisher.id)) {
      uniquePublishers.set(publisher.id, {
        host,
        publisher: publisher as (typeof ALLOWED_PUBLISHERS)[PublisherHost],
      });
    }
  }

  return [...uniquePublishers.values()].map(({ host, publisher }) =>
      sourceRegistryEntrySchema.parse({
        sourceId: `naver-news-${publisher.id}`,
        name: publisher.name,
        publisherGroupId: publisher.id,
        provenanceGroupPrefix: `naver-search:${publisher.id}`,
        collectionType: "api",
        feedUrl: `${NAVER_NEWS_PROXY_ORIGIN}${NAVER_NEWS_PROXY_PATH}`,
        siteUrl: `https://${host}/`,
        publisherType: publisher.id === "ebs-news" ? "official" : "news",
        // A publisher hostname does not prove that an individual article is
        // original reporting. Naver metadata remains discovery-only and is
        // never counted as an independent evidence source without a later,
        // article-level provenance review.
        originType: publisher.role === "supporting" ? "wire" : "unknown",
        sourceRole: "supporting",
        sourceType: "news",
        authority: "none",
        contentUse: "discovery_only",
        locale: "ko-KR",
        enabled: true,
        accessStatus: "allowed",
        accessReviewedAt: "2026-08-13T00:00:00+09:00",
        policyReferenceUrls: [
          "https://developers.naver.com/docs/serviceapi/search/news/news.md",
        ],
        requestPolicy: {
          timeoutMs: 15_000,
          minIntervalMs: 86_400_000,
          maxResponseBytes: 1_000_000,
          maxItemsPerRun: 30,
          maxRedirects: 0,
        },
        notes:
          "네이버 검색 Open API 프록시에서 제목·원문 링크·발행시각만 발견 정보로 저장합니다. 검색 요약과 기사 본문은 저장하거나 생성형 AI 입력·발행 근거로 사용하지 않습니다.",
      }),
    );
}

export async function collectNaverNewsSources(input: {
  sources: readonly SourceRegistryEntry[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<Map<string, SourceCollectionOutcome>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const sourceById = new Map(
    input.sources.map((source) => [source.sourceId, sourceRegistryEntrySchema.parse(source)]),
  );
  const itemsBySource = new Map<string, NaverItem[]>();

  for (const query of NAVER_NEWS_QUERIES) {
    const url = new URL(NAVER_NEWS_PROXY_PATH, NAVER_NEWS_PROXY_ORIGIN);
    url.searchParams.set("q", query);
    url.searchParams.set("display", String(NAVER_NEWS_MAX_ITEMS_PER_QUERY));
    url.searchParams.set("sort", "date");
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: input.signal,
    });
    if (!response.ok) throw new Error(`NAVER_NEWS_PROXY_${response.status}`);
    const payload = (await response.json()) as { items?: unknown };
    if (!Array.isArray(payload.items)) throw new Error("NAVER_NEWS_RESPONSE_INVALID");
    for (const raw of payload.items) {
      if (raw === null || typeof raw !== "object") continue;
      const candidate = raw as Partial<NaverItem>;
      const originalUrl = normalizeOriginalUrl(candidate.original_link ?? candidate.link ?? "");
      if (!originalUrl || typeof candidate.title !== "string" || typeof candidate.description !== "string" || typeof candidate.pub_date_iso !== "string") continue;
      const publisher = publisherForUrl(originalUrl);
      if (!publisher) continue;
      const sourceId = `naver-news-${publisher.id}`;
      if (!sourceById.has(sourceId)) continue;
      const items = itemsBySource.get(sourceId) ?? [];
      items.push({ ...candidate, original_link: originalUrl } as NaverItem);
      itemsBySource.set(sourceId, items);
    }
  }

  const outcomes = new Map<string, SourceCollectionOutcome>();
  for (const [sourceId, source] of sourceById) {
    const unique = new Map<string, NaverItem>();
    for (const item of itemsBySource.get(sourceId) ?? []) {
      const url = item.original_link;
      if (url) unique.set(url, item);
    }
    const items = [...unique.values()]
      .sort((left, right) => Date.parse(right.pub_date_iso) - Date.parse(left.pub_date_iso) || left.title.localeCompare(right.title, "ko"))
      .slice(0, source.requestPolicy.maxItemsPerRun)
      .map((item) => ({
        sourceId,
        externalId: `naver:${sha256(item.original_link ?? item.link).slice(0, 32)}`,
        originalUrl: item.original_link ?? item.link,
        hostedArticleUrl: normalizeHostedArticleUrl(item.link),
        title: clean(item.title),
        excerpt: null,
        author: null,
        publisher: source.name,
        publishedAt: new Date(item.pub_date_iso).toISOString(),
        publishedAtPrecision: "instant" as const,
        discoveredAt: now().toISOString(),
      }));
    outcomes.set(
      sourceId,
      sourceCollectionOutcomeSchema.parse({
        sourceId,
        status: "succeeded",
        startedAt,
        finishedAt: now().toISOString(),
        items,
        issues: [],
      }),
    );
  }
  return outcomes;
}
