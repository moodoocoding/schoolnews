import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202608140029_allow_article_rediscovery.sql",
  ),
  "utf8",
);

describe("article rediscovery forward migration", () => {
  it("원본 RPC를 한 번만 안전하게 패치하는 명시적 transaction이다", () => {
    expect(sql.trimStart()).toMatch(/^--[\s\S]*?\nbegin;/);
    expect(sql.trimEnd()).toMatch(/commit;$/);
    expect(sql).toContain("to_regprocedure(");
    expect(sql).toContain("pg_get_functiondef(v_signature)");
    expect(sql).toContain("PERSIST_COLLECTED_CONTENT_DEFINITION_MISMATCH");
    expect(sql).toContain("execute replace(v_definition, v_discovery_identity_clause, '')");
    expect(sql).not.toMatch(/drop\s+(function|table|schema)/i);
    expect(sql).not.toMatch(/delete\s+from\s+news_clipping_private\.articles/i);
    expect(sql).not.toMatch(/update\s+news_clipping_private\.articles/i);
  });

  it("재수집 시각만 identity 비교에서 제외하고 기존 권한 경계를 재확정한다", () => {
    expect(sql).toContain(
      "v_existing_article.discovered_at is distinct from (v_article ->> ''discoveredAt'')::timestamptz",
    );
    expect(sql).toContain("from public, anon, authenticated;");
    expect(sql).toContain("to service_role;");
    expect(sql).toContain("preserves the stored first-discovered timestamp");
  });
});
