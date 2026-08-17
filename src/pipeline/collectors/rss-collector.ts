import {
  sourceCollectionOutcomeSchema,
  sourceRegistryEntrySchema,
  type CollectionIssue,
  type SourceCollectionOutcome,
  type SourceRegistryEntry,
} from "../../contracts";
import { CollectorError } from "./collector-error";
import {
  assertSafeRequestUrl,
  lookupPublicAddresses,
  type DnsLookup,
} from "./network-safety";
import { parseRssFeed } from "./rss-parser";
import { RSS_COLLECTOR_USER_AGENT } from "./source-registry";

export interface RssCollectorDependencies {
  fetch?: typeof globalThis.fetch;
  lookup?: DnsLookup;
  now?: () => Date;
  userAgent?: string;
  /** Optional outer cancellation propagated by the daily runner. */
  signal?: AbortSignal;
}

const XML_CONTENT_TYPES = new Set([
  "application/atom+xml",
  "application/rss+xml",
  "application/xml",
  "text/xml",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function asIssue(error: unknown): CollectionIssue {
  if (error instanceof CollectorError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      itemIndex: null,
    };
  }
  return {
    code: "SOURCE_UNAVAILABLE",
    message: "수집원 응답을 가져오지 못했습니다.",
    retryable: true,
    itemIndex: null,
  };
}

async function readLimitedText(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > maximumBytes
  ) {
    throw new CollectorError(
      "RESPONSE_TOO_LARGE",
      "RSS 응답이 수집 크기 한도를 초과했습니다.",
    );
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let aborted = signal.aborted;
  const handleAbort = () => {
    aborted = true;
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", handleAbort, { once: true });
  try {
    if (aborted) {
      throw new CollectorError(
        "COLLECTION_TIMEOUT",
        "RSS 수집원 본문 읽기 제한 시간을 초과했습니다.",
        { retryable: true },
      );
    }
    while (true) {
      const { done, value } = await reader.read();
      if (aborted) {
        throw new CollectorError(
          "COLLECTION_TIMEOUT",
          "RSS 수집원 본문 읽기 제한 시간을 초과했습니다.",
          { retryable: true },
        );
      }
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new CollectorError(
          "RESPONSE_TOO_LARGE",
          "RSS 응답이 수집 크기 한도를 초과했습니다.",
        );
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", handleAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function fetchRssXml(
  source: SourceRegistryEntry,
  dependencies: Required<Pick<RssCollectorDependencies, "fetch" | "lookup" | "userAgent">>,
  signal: AbortSignal,
): Promise<{ baseUrl: string; xml: string }> {
  let currentUrl = source.feedUrl;
  const allowedOrigin = new URL(source.feedUrl).origin;

  for (
    let redirectCount = 0;
    redirectCount <= source.requestPolicy.maxRedirects;
    redirectCount += 1
  ) {
    const safeUrl = await assertSafeRequestUrl(
      currentUrl,
      dependencies.lookup,
      signal,
    );
    if (safeUrl.origin !== allowedOrigin) {
      throw new CollectorError(
        "UNSAFE_SOURCE_URL",
        "등록된 RSS 수집원과 다른 출처로 향하는 요청을 차단했습니다.",
      );
    }
    let response: Response;
    try {
      response = await dependencies.fetch(safeUrl, {
        headers: {
          Accept:
            "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
          "User-Agent": dependencies.userAgent,
        },
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw new CollectorError(
          "COLLECTION_TIMEOUT",
          "RSS 수집원 응답 시작 제한 시간을 초과했습니다.",
          { cause: error, retryable: true },
        );
      }
      throw new CollectorError(
        "SOURCE_UNAVAILABLE",
        "RSS 수집원에 연결하지 못했습니다.",
        { cause: error, retryable: true },
      );
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (location === null) {
        throw new CollectorError(
          "SOURCE_UNAVAILABLE",
          "RSS 리다이렉트 위치가 없습니다.",
          { retryable: true },
        );
      }
      if (redirectCount === source.requestPolicy.maxRedirects) {
        throw new CollectorError(
          "REDIRECT_LIMIT_EXCEEDED",
          "RSS 리다이렉트 허용 횟수를 초과했습니다.",
        );
      }
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new CollectorError(
        "SOURCE_UNAVAILABLE",
        `RSS 수집원이 HTTP ${response.status}로 응답했습니다.`,
        { retryable: response.status >= 500 || response.status === 429 },
      );
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    const isDeclaredXml = contentType !== undefined && XML_CONTENT_TYPES.has(contentType);
    // Some CMSes (e.g. 인공지능신문) serve a genuine RSS body under
    // text/html. Only that one mislabel gets a second chance, and only if
    // the body itself unambiguously opens as XML/RSS/Atom/RDF -- a real
    // HTML error or redirect page always opens with <!doctype or <html and
    // still fails this check.
    if (!isDeclaredXml && contentType !== "text/html") {
      throw new CollectorError(
        "UNSUPPORTED_CONTENT_TYPE",
        "RSS 수집원이 XML 형식으로 응답하지 않았습니다.",
      );
    }

    let xml: string;
    try {
      xml = await readLimitedText(
        response,
        source.requestPolicy.maxResponseBytes,
        signal,
      );
    } catch (error) {
      if (error instanceof CollectorError) {
        throw error;
      }
      if (signal.aborted) {
        throw new CollectorError(
          "COLLECTION_TIMEOUT",
          "RSS 수집원 본문 읽기 제한 시간을 초과했습니다.",
          { cause: error, retryable: true },
        );
      }
      throw new CollectorError(
        "INVALID_SOURCE_DATA",
        "RSS 응답이 유효한 UTF-8 문자열이 아닙니다.",
        { cause: error },
      );
    }

    if (!isDeclaredXml) {
      const sniff = xml.trimStart().slice(0, 200).toLowerCase();
      const looksLikeXmlFeed =
        sniff.startsWith("<?xml") ||
        sniff.startsWith("<rss") ||
        sniff.startsWith("<feed") ||
        sniff.startsWith("<rdf");
      if (!looksLikeXmlFeed) {
        throw new CollectorError(
          "UNSUPPORTED_CONTENT_TYPE",
          "RSS 수집원이 XML 형식으로 응답하지 않았습니다.",
        );
      }
    }

    return { baseUrl: safeUrl.toString(), xml };
  }

  throw new CollectorError(
    "REDIRECT_LIMIT_EXCEEDED",
    "RSS 리다이렉트 허용 횟수를 초과했습니다.",
  );
}

export async function collectRssSource(
  input: SourceRegistryEntry,
  dependencies: RssCollectorDependencies = {},
): Promise<SourceCollectionOutcome> {
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const parsedSource = sourceRegistryEntrySchema.safeParse(input);
  if (!parsedSource.success || !parsedSource.data.enabled) {
    const finishedAt = now().toISOString();
    return sourceCollectionOutcomeSchema.parse({
      sourceId: input.sourceId,
      status: "failed",
      startedAt,
      finishedAt,
      items: [],
      issues: [
        {
          code: "INVALID_SOURCE_DATA",
          message: "활성화된 검토 완료 RSS 수집원이 아닙니다.",
          retryable: false,
          itemIndex: null,
        },
      ],
    });
  }

  const source = parsedSource.data;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    source.requestPolicy.timeoutMs,
  );
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, controller.signal])
    : controller.signal;

  try {
    const fetched = await fetchRssXml(
      source,
      {
        fetch: dependencies.fetch ?? globalThis.fetch,
        lookup: dependencies.lookup ?? lookupPublicAddresses,
        userAgent: dependencies.userAgent ?? RSS_COLLECTOR_USER_AGENT,
      },
      signal,
    );
    const parsed = parseRssFeed(fetched.xml, source, startedAt, fetched.baseUrl);
    const status =
      parsed.issues.length === 0
        ? "succeeded"
        : parsed.items.length > 0
          ? "partial"
          : "failed";

    return sourceCollectionOutcomeSchema.parse({
      sourceId: source.sourceId,
      status,
      startedAt,
      finishedAt: now().toISOString(),
      items: parsed.items,
      issues: parsed.issues,
    });
  } catch (error) {
    return sourceCollectionOutcomeSchema.parse({
      sourceId: source.sourceId,
      status: "failed",
      startedAt,
      finishedAt: now().toISOString(),
      items: [],
      issues: [asIssue(error)],
    });
  } finally {
    clearTimeout(timeout);
  }
}
