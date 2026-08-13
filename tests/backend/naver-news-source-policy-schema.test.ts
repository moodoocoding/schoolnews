import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createNaverPublisherSources } from "../../src/pipeline/collectors";

const migration = readFileSync(
  "supabase/migrations/202608130020_naver_news_source_policies.sql",
  "utf8",
);
const chosunMigration = readFileSync(
  "supabase/migrations/202608130021_chosun_discovery_source_policy.sql",
  "utf8",
);
const summaryMigration = readFileSync(
  "supabase/migrations/202608140024_naver_summary_source_policies.sql",
  "utf8",
);

describe("Naver News source interval policies", () => {
  it("registers every configured publisher adapter for one daily attempt", () => {
    for (const source of createNaverPublisherSources()) {
      const expected = `('${source.sourceId}', 86400000)`;
      expect(
        migration.includes(expected) ||
          chosunMigration.includes(expected) ||
          summaryMigration.includes(expected),
      ).toBe(true);
    }
  });

  it("registers the summary adapters in a separate forward migration", () => {
    expect(summaryMigration.trim().toLowerCase()).toMatch(/^--[\s\S]*\nbegin;/);
    expect(summaryMigration.trim().toLowerCase()).toMatch(/commit;$/);
    expect(summaryMigration).toContain("on conflict (source_id) do update");
    expect(summaryMigration.toLowerCase()).not.toContain("delete ");
    expect(summaryMigration.toLowerCase()).not.toContain("drop ");
  });

  it("is a forward-only transactional upsert", () => {
    expect(migration.trim().toLowerCase()).toMatch(/^--[\s\S]*\nbegin;/);
    expect(migration.trim().toLowerCase()).toMatch(/commit;$/);
    expect(migration).toContain("on conflict (source_id) do update");
    expect(migration.toLowerCase()).not.toContain("delete ");
    expect(migration.toLowerCase()).not.toContain("drop ");
  });

  it("adds Chosun in a separate forward migration after policy 020 was applied", () => {
    expect(chosunMigration).toContain("('naver-news-chosun', 86400000)");
    expect(chosunMigration.trim().toLowerCase()).toMatch(/commit;$/);
  });
});
