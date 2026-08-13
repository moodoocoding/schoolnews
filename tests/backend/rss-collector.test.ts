import { afterEach, describe, expect, it, vi } from "vitest";

import type { SourceRegistryEntry } from "../../src/contracts";
import {
  collectRssSource,
  isUnsafeNetworkAddress,
  RSS_COLLECTOR_USER_AGENT,
  RSS_SOURCE_REGISTRY,
} from "../../src/pipeline/collectors";

const source = RSS_SOURCE_REGISTRY[0];
const publicLookup = vi.fn(async () => [
  { address: "203.0.114.20", family: 4 as const },
]);

const validRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>과기정통부 보도자료</title>
    <item>
      <title><![CDATA[AI &amp; 디지털 교육 정책]]></title>
      <link>https://www.msit.go.kr/bbs/view.do?b=2&amp;a=1&amp;utm_source=rss#top</link>
      <guid>press-1</guid>
      <pubDate>2026.08.12</pubDate>
      <description><![CDATA[<p>초등학교를 위한 <strong>짧은 요약</strong>입니다.</p><script>remove me</script>]]></description>
      <content:encoded><![CDATA[<p>저장하면 안 되는 원문 전체</p>]]></content:encoded>
    </item>
    <item>
      <title>발행일이 없는 항목</title>
      <link>https://www.msit.go.kr/bbs/invalid.do</link>
    </item>
  </channel>
</rss>`;

function response(
  body: string,
  init: ResponseInit = {},
): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
    ...init,
  });
}

function fixedNow(): Date {
  return new Date("2026-08-12T01:00:00.000Z");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  publicLookup.mockClear();
});

describe("RSS 수집원 등록부", () => {
  it("공식 과기정통부 보도자료 피드만 하루 주기로 활성화한다", () => {
    expect(RSS_SOURCE_REGISTRY).toHaveLength(1);
    expect(source).toMatchObject({
      sourceId: "msit-press-release",
      publisherGroupId: "msit",
      feedUrl: "https://www.msit.go.kr/user/rss/rss.do?bbsSeqNo=94",
      sourceRole: "primary",
      sourceType: "primary",
      authority: "public_authority_direct_fact",
      originType: "primary_document",
      accessStatus: "allowed",
    });
    expect(source.requestPolicy.minIntervalMs).toBe(86_400_000);
    expect(source.requestPolicy.timeoutMs).toBe(15_000);
    expect(RSS_COLLECTOR_USER_AGENT).toContain("AI-Education-Today");
  });
});

describe("안전한 RSS 수집", () => {
  it("필요한 메타데이터만 평문으로 수집하고 잘못된 항목은 격리한다", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("user-agent")).toBe(
        RSS_COLLECTOR_USER_AGENT,
      );
      return response(validRss);
    }) as unknown as typeof fetch;

    const outcome = await collectRssSource(source, {
      fetch: fetchMock,
      lookup: publicLookup,
      now: fixedNow,
    });

    expect(outcome.status).toBe("partial");
    expect(outcome.items).toHaveLength(1);
    expect(outcome.issues).toEqual([
      expect.objectContaining({ code: "ITEM_SKIPPED", itemIndex: 1 }),
    ]);
    expect(outcome.items[0]).toMatchObject({
      sourceId: "msit-press-release",
      externalId: "press-1",
      title: "AI & 디지털 교육 정책",
      excerpt: "초등학교를 위한 짧은 요약입니다.",
      publisher: "과학기술정보통신부",
      publishedAt: "2026-08-12T00:00:00+09:00",
      publishedAtPrecision: "date",
      discoveredAt: "2026-08-12T01:00:00.000Z",
    });
    expect(JSON.stringify(outcome)).not.toContain("원문 전체");
  });

  it("RSS 2.0과 Atom의 최소 필드를 모두 파싱한다", async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Atom 교육 소식</title><id>atom-1</id>
      <link rel="alternate" href="https://www.msit.go.kr/atom/1" />
      <published>2026-08-12T09:00:00+09:00</published>
      <summary type="html">&lt;b&gt;짧은 소식&lt;/b&gt;</summary>
      <author><name>홍길동</name></author></entry></feed>`;
    const fetchMock = vi.fn(async () => response(atom)) as unknown as typeof fetch;

    const outcome = await collectRssSource(source, {
      fetch: fetchMock,
      lookup: publicLookup,
      now: fixedNow,
    });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.items[0]).toMatchObject({
      externalId: "atom-1",
      author: "홍길동",
      excerpt: "짧은 소식",
    });
  });

  it("DTD와 엔티티를 포함한 XML을 전체 실패로 차단한다", async () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&xxe;</title></item></channel></rss>`;
    const fetchMock = vi.fn(async () => response(xml)) as unknown as typeof fetch;

    const outcome = await collectRssSource(source, {
      fetch: fetchMock,
      lookup: publicLookup,
      now: fixedNow,
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.issues[0].code).toBe("INVALID_SOURCE_DATA");
  });

  it("잘못된 XML과 XML이 아닌 응답을 각각 거부한다", async () => {
    const malformedFetch = vi.fn(async () => response("<rss><channel>")) as unknown as typeof fetch;
    const htmlFetch = vi.fn(async () =>
      response("<html></html>", {
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    const malformed = await collectRssSource(source, {
      fetch: malformedFetch,
      lookup: publicLookup,
      now: fixedNow,
    });
    const unsupported = await collectRssSource(source, {
      fetch: htmlFetch,
      lookup: publicLookup,
      now: fixedNow,
    });

    expect(malformed.issues[0].code).toBe("INVALID_SOURCE_DATA");
    expect(unsupported.issues[0].code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("허용 크기를 초과한 응답을 읽기 전에 거부한다", async () => {
    const fetchMock = vi.fn(async () =>
      response(validRss, {
        headers: {
          "content-type": "application/xml",
          "content-length": String(source.requestPolicy.maxResponseBytes + 1),
        },
      })) as unknown as typeof fetch;

    const outcome = await collectRssSource(source, {
      fetch: fetchMock,
      lookup: publicLookup,
      now: fixedNow,
    });

    expect(outcome.issues[0].code).toBe("RESPONSE_TOO_LARGE");
  });

  it("타임아웃을 재시도 가능한 실패로 반환한다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;

    const outcomePromise = collectRssSource(source, {
      fetch: fetchMock,
      lookup: publicLookup,
      now: fixedNow,
    });
    await vi.advanceTimersByTimeAsync(source.requestPolicy.timeoutMs);
    const outcome = await outcomePromise;

    expect(outcome.issues[0]).toMatchObject({
      code: "COLLECTION_TIMEOUT",
      message: "RSS 수집원 응답 시작 제한 시간을 초과했습니다.",
      retryable: true,
    });
  });

  it("DNS 조회가 멈춰도 전체 수집 시간 한도를 적용한다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => response(validRss)) as unknown as typeof fetch;
    const outcomePromise = collectRssSource(source, {
      fetch: fetchMock,
      lookup: () => new Promise(() => undefined),
      now: fixedNow,
    });

    await vi.advanceTimersByTimeAsync(source.requestPolicy.timeoutMs);
    const outcome = await outcomePromise;

    expect(outcome.issues[0]).toMatchObject({
      code: "COLLECTION_TIMEOUT",
      message: "RSS 수집원 DNS 확인 제한 시간을 초과했습니다.",
      retryable: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("본문 스트림이 멈추면 응답 시작과 구분된 제한 시간 실패를 반환한다", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<?xml version=\"1.0\"?><rss>"));
      },
    });
    const fetchMock = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    }) as unknown as typeof fetch;

    const outcomePromise = collectRssSource(source, {
      fetch: fetchMock,
      lookup: publicLookup,
      now: fixedNow,
    });
    await vi.advanceTimersByTimeAsync(source.requestPolicy.timeoutMs);
    const outcome = await outcomePromise;

    expect(outcome.issues[0]).toMatchObject({
      code: "COLLECTION_TIMEOUT",
      message: "RSS 수집원 본문 읽기 제한 시간을 초과했습니다.",
      retryable: true,
    });
  });

  it("사설 DNS와 위험한 리다이렉트를 요청 전에 차단한다", async () => {
    const neverFetch = vi.fn(async () => response(validRss)) as unknown as typeof fetch;
    const privateDns = await collectRssSource(source, {
      fetch: neverFetch,
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      now: fixedNow,
    });
    expect(privateDns.issues[0].code).toBe("UNSAFE_SOURCE_URL");
    expect(neverFetch).not.toHaveBeenCalled();

    const redirectFetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/private" },
      })) as unknown as typeof fetch;
    const redirect = await collectRssSource(source, {
      fetch: redirectFetch,
      lookup: publicLookup,
      now: fixedNow,
    });
    expect(redirect.issues[0].code).toBe("UNSAFE_SOURCE_URL");
    expect(redirectFetch).toHaveBeenCalledTimes(1);
  });

  it("주요 IPv4·IPv6 로컬·사설·예약 대역을 식별한다", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "169.254.1.1",
      "192.0.2.1",
      "224.0.0.1",
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isUnsafeNetworkAddress(address), address).toBe(true);
    }
    expect(isUnsafeNetworkAddress("8.8.8.8")).toBe(false);
    expect(isUnsafeNetworkAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("리다이렉트 횟수 한도를 넘으면 중단한다", async () => {
    const limitedSource: SourceRegistryEntry = {
      ...source,
      requestPolicy: { ...source.requestPolicy, maxRedirects: 1 },
    };
    const redirectFetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://www.msit.go.kr/next.xml" },
      })) as unknown as typeof fetch;

    const outcome = await collectRssSource(limitedSource, {
      fetch: redirectFetch,
      lookup: publicLookup,
      now: fixedNow,
    });

    expect(outcome.issues[0].code).toBe("REDIRECT_LIMIT_EXCEEDED");
    expect(redirectFetch).toHaveBeenCalledTimes(2);
  });

  it("등록된 수집원과 다른 origin으로 향하는 리다이렉트를 차단한다", async () => {
    const redirectFetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://public.example.org/feed.xml" },
      })) as unknown as typeof fetch;

    const outcome = await collectRssSource(source, {
      fetch: redirectFetch,
      lookup: publicLookup,
      now: fixedNow,
    });

    expect(outcome.issues[0].code).toBe("UNSAFE_SOURCE_URL");
    expect(redirectFetch).toHaveBeenCalledTimes(1);
  });
});
