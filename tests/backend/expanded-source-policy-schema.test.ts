import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RSS_SOURCE_REGISTRY } from "../../src/pipeline/collectors";

const migration = readFileSync(
  "supabase/migrations/202608140023_expand_daily_source_policies.sql",
  "utf8",
);

describe("expanded daily source policies", () => {
  it("registers every RSS source added after the original MSIT policy", () => {
    for (const source of RSS_SOURCE_REGISTRY.filter(
      (entry) => entry.sourceId !== "msit-press-release",
    )) {
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
