import { afterEach, describe, expect, it } from "vitest";

import { GET } from "../../src/app/api/cron/daily/route";

const originalSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("daily Cron route", () => {
  it("rejects unauthenticated requests before importing operational clients", async () => {
    process.env.CRON_SECRET = "test-cron-secret-value-123456";
    const response = await GET(
      new Request("https://schoolnews.example/api/cron/daily?runDate=1999-01-01"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
  });
});
