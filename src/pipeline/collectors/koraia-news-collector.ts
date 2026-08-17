import {
  sourceCollectionOutcomeSchema,
  sourceRegistryEntrySchema,
  type CollectionIssue,
  type SourceCollectionOutcome,
  type SourceRegistryEntry,
} from "../../contracts";

export const KORAIA_SOURCE_ID = "koraia-ai-news";
export const KORAIA_SUPABASE_URL = "https://kydkwdwtsqsjxasirxoi.supabase.co";
// Supabase "publishable" key: the same key report.koraia.org ships in its own
// public page JS for browser-side reads. Not a credential we are bypassing.
export const KORAIA_SUPABASE_ANON_KEY = "sb_publishable_8s2AtTlUWOaLtiOvdsH7jQ_t7gVjUCM";
export const KORAIA_TABLE = "ai_info";
export const KORAIA_QUERY_TIMEOUT_MS = 15_000;

export function createKoraiaSource(): SourceRegistryEntry {
  return sourceRegistryEntrySchema.parse({
    sourceId: KORAIA_SOURCE_ID,
    name: "한국인공지능협회 AI뉴스 모음",
    publisherGroupId: "koraia",
    provenanceGroupPrefix: "koraia-aggregate",
    collectionType: "api",
    feedUrl: `${KORAIA_SUPABASE_URL}/rest/v1/${KORAIA_TABLE}`,
    siteUrl: "https://report.koraia.org/info",
    publisherType: "other",
    originType: "unknown",
    sourceRole: "supporting",
    sourceType: "news",
    authority: "none",
    contentUse: "discovery_only",
    locale: "ko-KR",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-17T00:00:00+09:00",
    policyReferenceUrls: [
      "https://report.koraia.org/info",
      "https://koraia.org/robots.txt",
    ],
    requestPolicy: {
      timeoutMs: KORAIA_QUERY_TIMEOUT_MS,
      minIntervalMs: 86_400_000,
      maxResponseBytes: 1_000_000,
      maxItemsPerRun: 50,
      maxRedirects: 0,
    },
    notes:
      "한국인공지능협회가 report.koraia.org/info 페이지에서 공개 사용하는 Supabase 읽기 전용 REST API(ai_info 테이블)입니다. 프론트엔드에 노출된 것과 동일한 공개 anon 키로 title, url, created_at만 조회하며 원문 페이지는 크롤링하지 않습니다. 이 목록은 여러 언론사 기사를 모아 소개하는 큐레이션이라 개별 기사의 원 출처를 검증할 수 없어 originType은 unknown, contentUse는 discovery_only로 둡니다.",
  });
}

function normalizeKoraiaUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function collectKoraiaNewsSource(input: {
  source: SourceRegistryEntry;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<SourceCollectionOutcome> {
  const source = sourceRegistryEntrySchema.parse(input.source);
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KORAIA_QUERY_TIMEOUT_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, controller.signal])
    : controller.signal;

  try {
    const url = new URL(`${KORAIA_SUPABASE_URL}/rest/v1/${KORAIA_TABLE}`);
    url.searchParams.set("select", "id,title,url,created_at");
    url.searchParams.set("order", "id.desc");
    url.searchParams.set("limit", String(source.requestPolicy.maxItemsPerRun));

    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        apikey: KORAIA_SUPABASE_ANON_KEY,
        authorization: `Bearer ${KORAIA_SUPABASE_ANON_KEY}`,
      },
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error(`KORAIA_API_HTTP_${response.status}`);
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error("KORAIA_RESPONSE_INVALID");

    const items = [];
    for (const raw of payload) {
      if (raw === null || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      if (
        typeof row.title !== "string" ||
        typeof row.url !== "string" ||
        typeof row.created_at !== "string"
      ) {
        continue;
      }
      const originalUrl = normalizeKoraiaUrl(row.url);
      if (!originalUrl) continue;
      const publishedAt = new Date(row.created_at);
      if (Number.isNaN(publishedAt.getTime())) continue;
      const title = row.title.trim();
      if (title.length === 0) continue;
      items.push({
        sourceId: source.sourceId,
        externalId: `koraia:${row.id ?? originalUrl}`,
        originalUrl,
        hostedArticleUrl: null,
        title: title.slice(0, 500),
        excerpt: null,
        author: null,
        publisher: source.name,
        publishedAt: publishedAt.toISOString(),
        publishedAtPrecision: "instant" as const,
        discoveredAt: now().toISOString(),
      });
    }

    return sourceCollectionOutcomeSchema.parse({
      sourceId: source.sourceId,
      status: "succeeded",
      startedAt,
      finishedAt: now().toISOString(),
      items,
      issues: [],
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    const code: CollectionIssue["code"] = controller.signal.aborted
      ? "COLLECTION_TIMEOUT"
      : "SOURCE_UNAVAILABLE";
    const detail =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return sourceCollectionOutcomeSchema.parse({
      sourceId: source.sourceId,
      status: "failed",
      startedAt,
      finishedAt: now().toISOString(),
      items: [],
      issues: [
        {
          code,
          message: `한국인공지능협회 AI 뉴스 API 호출 실패: ${detail}`.slice(0, 500),
          retryable: true,
          itemIndex: null,
        },
      ],
    });
  } finally {
    clearTimeout(timeout);
  }
}
