import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Vercel daily cron", () => {
  it("runs at midnight Asia/Seoul, represented as 15:00 UTC", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons).toEqual([
      { path: "/api/cron/daily", schedule: "0 15 * * *" },
    ]);
  });
});
