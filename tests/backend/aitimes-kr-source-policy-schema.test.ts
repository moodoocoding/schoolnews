import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608170046_aitimes_kr_source_policy.sql",
  "utf8",
);

describe("인공지능신문(aitimes-kr) source interval policy", () => {
  it("registers the source for one daily attempt", () => {
    expect(migration).toContain("('aitimes-kr', 86400000)");
  });

  it("is a forward-only transactional upsert", () => {
    expect(migration.trim().toLowerCase()).toMatch(/^--[\s\S]*\nbegin;/);
    expect(migration.trim().toLowerCase()).toMatch(/commit;$/);
    expect(migration).toContain("on conflict (source_id) do update");
    expect(migration.toLowerCase()).not.toContain("delete ");
    expect(migration.toLowerCase()).not.toContain("drop ");
  });
});
