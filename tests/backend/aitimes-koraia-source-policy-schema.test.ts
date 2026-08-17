import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608170045_aitimes_koraia_source_policies.sql",
  "utf8",
);

describe("AI타임스/한국인공지능협회 source interval policies", () => {
  it("registers both new sources for one daily attempt", () => {
    expect(migration).toContain("('aitimes-com', 86400000)");
    expect(migration).toContain("('koraia-ai-news', 86400000)");
  });

  it("is a forward-only transactional upsert", () => {
    expect(migration.trim().toLowerCase()).toMatch(/^--[\s\S]*\nbegin;/);
    expect(migration.trim().toLowerCase()).toMatch(/commit;$/);
    expect(migration).toContain("on conflict (source_id) do update");
    expect(migration.toLowerCase()).not.toContain("delete ");
    expect(migration.toLowerCase()).not.toContain("drop ");
  });
});
