import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createNaverPublisherSources } from "../../src/pipeline/collectors";

const migration = readFileSync(
  "supabase/migrations/202608130020_naver_news_source_policies.sql",
  "utf8",
);

describe("Naver News source interval policies", () => {
  it("registers every configured publisher adapter for one daily attempt", () => {
    for (const source of createNaverPublisherSources()) {
      expect(migration).toContain(`('${source.sourceId}', 86400000)`);
    }
  });

  it("is a forward-only transactional upsert", () => {
    expect(migration.trim().toLowerCase()).toMatch(/^--[\s\S]*\nbegin;/);
    expect(migration.trim().toLowerCase()).toMatch(/commit;$/);
    expect(migration).toContain("on conflict (source_id) do update");
    expect(migration.toLowerCase()).not.toContain("delete ");
    expect(migration.toLowerCase()).not.toContain("drop ");
  });
});
