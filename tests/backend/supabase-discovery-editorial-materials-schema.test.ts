import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608140033_include_discovery_editorial_materials.sql",
  ),
  "utf8",
);
const baseFunctionSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608140025_rolling_editorial_materials.sql",
  ),
  "utf8",
);

describe("discovery editorial material migration", () => {
  it("removes only the evidence-only article filter from the existing RPC", () => {
    expect(sql).toContain("public.get_rolling_editorial_materials(date,integer)");
    expect(sql).toContain("v_evidence_only_clause");
    expect(sql).toContain("execute replace(v_definition, v_evidence_only_clause, '')");
    expect(sql).toContain("EDITORIAL_MATERIALS_RPC_DEFINITION_MISMATCH");
  });

  it("keeps the accessStatus = 'allowed' filter untouched", () => {
    // The base function this migration patches (202608140025) gates on both
    // accessStatus and contentUse. 033 must only strip the contentUse clause:
    // the removed literal must not also match the accessStatus filter, and
    // the base function's accessStatus line must still exist for this
    // migration's `replace()` to leave in place.
    expect(baseFunctionSql).toContain(
      "source.registry_payload ->> 'accessStatus' = 'allowed'",
    );
    const clauseMatch = sql.match(
      /v_evidence_only_clause constant text :=\s*\n?\s*(E?'[^;]*');/,
    );
    expect(clauseMatch).not.toBeNull();
    expect(clauseMatch?.[1]).not.toMatch(/accessStatus/);
    expect(clauseMatch?.[1]).toMatch(/contentUse/);
  });

  it("keeps the read boundary service-role only and applies atomically", () => {
    expect(sql.trimStart().startsWith("-- Rolling editorial material")).toBe(true);
    expect(sql).toMatch(/\nbegin;\n/);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
  });
});
