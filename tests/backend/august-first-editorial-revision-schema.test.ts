import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve("supabase/migrations/202608130014_revise_august_first_editorial.sql"),
  "utf8",
).toLowerCase();

describe("8월 1일 편집 교정 RPC", () => {
  it("한 날짜·한 게시물·새 리비전과 7월 30일 출처로 범위를 제한한다", () => {
    expect(sql).toContain("publication_date_kst = date '2026-08-01'");
    expect(sql).toContain("p_expected_active_revision_id");
    expect(sql).toContain("insert into news_clipping_private.post_revisions");
    expect(sql.match(/2026-07-30/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("v_body_length not between 600 and 1000");
  });

  it("공개 역할을 차단하고 service_role만 실행할 수 있다", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = pg_catalog, news_clipping_private");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql.trimStart().startsWith("-- one-time")).toBe(true);
    expect(sql).toContain("begin;");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
});
