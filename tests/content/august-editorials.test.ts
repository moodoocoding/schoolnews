import { describe, expect, it } from "vitest";

import {
  AUGUST_EDITORIAL_POSTS,
  AUGUST_EDITORIAL_SOURCES,
} from "../../scripts/revise-august-2-13-editorials";

describe("August 2-13 thought-piece editorials", () => {
  it("contains every date exactly once with three 600-1000 character paragraphs", () => {
    expect(AUGUST_EDITORIAL_POSTS.map((item) => item.date)).toEqual(
      Array.from({ length: 12 }, (_, index) =>
        `2026-08-${String(index + 2).padStart(2, "0")}`,
      ),
    );
    for (const item of AUGUST_EDITORIAL_POSTS) {
      expect(item.post.body).toHaveLength(3);
      expect(item.bodyLength).toBeGreaterThanOrEqual(600);
      expect(item.bodyLength).toBeLessThanOrEqual(1_000);
      expect(item.post.questions).toHaveLength(1);
    }
  });

  it("uses only the approved domestic source hosts", () => {
    const hosts = new Set([
      "www.kedi.re.kr",
      "keris.or.kr",
      "www.moe.go.kr",
      "m.pipc.go.kr",
      "www.hangyo.com",
    ]);
    for (const source of AUGUST_EDITORIAL_SOURCES) {
      expect(hosts.has(new URL(source.url).hostname)).toBe(true);
    }
    for (const item of AUGUST_EDITORIAL_POSTS) {
      expect(item.post.sources).toHaveLength(2);
      expect(
        item.post.sources.every((source) =>
          hosts.has(new URL(source.originalUrl).hostname),
        ),
      ).toBe(true);
    }
  });
});
