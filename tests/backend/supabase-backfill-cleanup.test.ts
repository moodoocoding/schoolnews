import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/202608130014_remove_august_backfill_publish.sql",
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, "utf8");

describe("August backfill cleanup migration", () => {
  it("drops only the temporary backfill RPC inside a transaction", () => {
    expect(migration).toMatch(/^--[\s\S]*\nbegin;/);
    expect(migration).toContain(
      "drop function if exists public.publish_backfill_post(",
    );
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).not.toMatch(/drop\s+(table|schema)/i);
    expect(migration).not.toMatch(/delete\s+from|truncate|update\s+/i);
    expect(migration).not.toContain("public.publish_post(");
  });
});
