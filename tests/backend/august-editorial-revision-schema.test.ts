import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608130018_august_editorial_revision.sql",
  ),
  "utf8",
).toLowerCase();

describe("August editorial revision migration", () => {
  it("is atomic, service-role-only and requires the archive snapshot", () => {
    expect(migration.trimStart().startsWith("-- one-time")).toBe(true);
    expect(migration).toContain("begin;");
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).toContain("archive_snapshot_required");
    expect(migration).toContain("get_august_editorial_targets");
    expect(migration).toContain("active_revision_id is distinct from p_expected_active_revision_id");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });

  it("enforces domestic hosts, three paragraphs and 600-1000 body characters", () => {
    expect(migration).toContain("jsonb_array_length(p_post -> 'body') <> 3");
    expect(migration).toContain("v_body_length not between 600 and 1000");
    expect(migration).toContain("moe\\.go\\.kr");
    expect(migration).toContain("kedi\\.re\\.kr");
    expect(migration).toContain("keris\\.or\\.kr");
    expect(migration).toContain("m\\.pipc\\.go\\.kr");
    expect(migration).toContain("hangyo\\.com");
  });
});
