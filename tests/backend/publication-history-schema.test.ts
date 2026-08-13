import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608130010_publication_history.sql"),
  "utf8",
).replace(/\s+/g, " ").toLowerCase();

describe("publication history migration", () => {
  it("published projection과 private post를 같이 확인하고 최대 365건만 읽는다", () => {
    expect(sql).toContain("create or replace function public.get_publication_history");
    expect(sql).toContain("stable security definer set search_path = pg_catalog, news_clipping_private");
    expect(sql).toContain("join public.published_posts published on published.id = p.id");
    expect(sql).toContain("p.status = 'published'");
    expect(sql).toContain("published.status = 'published'");
    expect(sql).toContain("p_limit not between 1 and 365");
    expect(sql).toContain("message = 'invalid_publication_history_limit'");
  });

  it("published post와 연결된 article fingerprint만 distinct 조회한다", () => {
    expect(sql).toContain("join news_clipping_private.post_sources source on source.post_id = post.id");
    expect(sql).toContain("join news_clipping_private.articles article on article.id = source.article_id");
    expect(sql).toContain("select distinct article.content_fingerprint");
  });

  it("public·anon·authenticated를 폐쇄하고 service_role만 허용한다", () => {
    expect(sql).toContain("revoke all on function public.get_publication_history(integer) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.get_publication_history(integer) to service_role");
    expect(sql.trim().startsWith("-- bounded")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });
});
