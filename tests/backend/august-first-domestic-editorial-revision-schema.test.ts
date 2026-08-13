import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve("supabase/migrations/202608130015_revise_august_first_domestic_editorial.sql"),
  "utf8",
).toLowerCase();

describe("8월 1일 국내 기사 편집 교정 RPC", () => {
  it("국내 7월 30일 기사 두 건과 3문단·600~1000자만 허용한다", () => {
    expect(sql).toContain("https://www.hangyo.com/news/article.html?no=108663");
    expect(sql).toContain("https://www.news1.kr/society/education/6243467");
    expect(sql.match(/2026-07-30/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("jsonb_array_length(p_post -> 'body') < 3");
    expect(sql).toContain("v_body_length not between 600 and 1000");
    expect(sql).not.toContain("govtech.com");
    expect(sql).not.toContain("montereycountynow.com");
  });

  it("service_role 전용 트랜잭션과 불변 리비전을 유지한다", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = pg_catalog, news_clipping_private");
    expect(sql).toContain("insert into news_clipping_private.post_revisions");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("begin;");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
});
