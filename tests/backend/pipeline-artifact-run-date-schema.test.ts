import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202608130011_pipeline_artifact_run_date.sql",
  ),
  "utf8",
);

describe("011 pipeline artifact run-date migration", () => {
  it("returns the authoritative daily_runs date in a private envelope", () => {
    expect(migration).toContain("'runDate', run_row.run_date::text");
    expect(migration).toContain(
      "from news_clipping_private.daily_runs as run_row",
    );
    expect(migration).toContain("where run_row.run_id = p_row.run_id");
  });

  it("is transactional, fixed-search-path, and not directly executable", () => {
    expect(migration.trimStart().startsWith("--")).toBe(true);
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
    expect(migration).toContain(
      "set search_path = pg_catalog, news_clipping_private",
    );
    expect(migration).toMatch(
      /revoke all on function[\s\S]+from public, anon, authenticated, service_role;/u,
    );
  });
});
