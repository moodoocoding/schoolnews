import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608140031_migrate_naver_discovery_articles.sql",
  "utf8",
).toLowerCase();

describe("Naver discovery article lineage migration", () => {
  it("URL 기반 동일 기사 중 참조 없는 discovery row만 API summary 계보로 전환한다", () => {
    expect(sql).toContain("v_existing_article.source_id like ''naver-news-%''");
    expect(sql).toContain("''^naver-news-'', ''naver-summary-''");
    expect(sql).toContain("v_existing_article.excerpt is null");
    expect(sql).toContain("v_existing_article.origin_type in (''unknown'', ''wire'')");
    expect(sql).toContain("set source_id = v_article ->> ''sourceid''");
    expect(sql).toContain("excerpt = v_article ->> ''excerpt''");
    expect(sql).toContain("origin_type = v_article ->> ''origintype''");
  });

  it("evidence·topic·post 계보가 생긴 기사는 변경하지 않고 권한을 유지한다", () => {
    for (const table of ["evidence_items", "topic_articles", "post_sources"]) {
      expect(sql).toContain(`news_clipping_private.${table}`);
    }
    expect(sql).toContain("not exists");
    expect(sql).toContain("from public, anon, authenticated;");
    expect(sql).toContain("to service_role;");
    expect(sql).not.toMatch(/delete\s+from/i);
    expect(sql).not.toMatch(/drop\s+(function|table|schema)/i);
  });
});
