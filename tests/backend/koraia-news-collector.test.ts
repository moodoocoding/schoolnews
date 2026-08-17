import { describe, expect, it, vi } from "vitest";

import {
  collectKoraiaNewsSource,
  createKoraiaSource,
} from "../../src/pipeline/collectors";

function response(rows: unknown[]): Response {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("KORAIA AI news discovery collector", () => {
  it("is a discovery_only API source with a daily request policy", () => {
    const source = createKoraiaSource();
    expect(source.collectionType).toBe("api");
    expect(source.contentUse).toBe("discovery_only");
    expect(source.originType).toBe("unknown");
    expect(source.requestPolicy.minIntervalMs).toBe(86_400_000);
  });

  it("maps rows into discovery items and skips malformed ones", async () => {
    const source = createKoraiaSource();
    const fetchImpl = vi.fn(async () =>
      response([
        {
          id: 1,
          title: "AI 정책 관련 소식",
          url: "https://www.dt.co.kr/article/12345",
          created_at: "2026-08-17T05:51:02.281821+09:00",
        },
        { id: 2, title: "http만 지원", url: "http://insecure.example.com/a" },
        { id: 3, title: "", url: "https://example.com/empty-title" },
      ]),
    );

    const outcome = await collectKoraiaNewsSource({
      source,
      fetchImpl,
      now: () => new Date("2026-08-17T05:00:00.000Z"),
    });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.items).toHaveLength(1);
    expect(outcome.items[0]?.title).toBe("AI 정책 관련 소식");
    expect(outcome.items[0]?.originalUrl).toBe(
      "https://www.dt.co.kr/article/12345",
    );
    expect(outcome.items[0]?.excerpt).toBeNull();
  });

  it("reports a failed outcome with real error detail when the API errors", async () => {
    const source = createKoraiaSource();
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));

    const outcome = await collectKoraiaNewsSource({ source, fetchImpl });

    expect(outcome.status).toBe("failed");
    expect(outcome.items).toHaveLength(0);
    expect(outcome.issues[0]?.message).toContain("503");
  });
});
