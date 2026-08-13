import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202608130012_ec_digital_strategy_source_policy.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("012 EC digital strategy source policy migration", () => {
  it("is transactional and pins the same daily interval as the registry", () => {
    expect(migration.trim().startsWith("--")).toBe(true);
    expect(migration).toMatch(/\bbegin\s*;/i);
    expect(migration).toMatch(/\bcommit\s*;/i);
    expect(migration).toContain("'ec-digital-strategy', 86400000");
    expect(migration).toContain("source_collection_policies");
    expect(migration).not.toMatch(/\b(?:delete|drop|truncate)\b/i);
  });
});
