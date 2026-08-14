import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608140032_refresh_unreferenced_article_text.sql",
  "utf8",
).toLowerCase();

describe("unreferenced article text refresh migration", () => {
  it("정규화 제목과 내용 지문이 같은 동일 출처 기사만 제목·요약을 갱신한다", () => {
    expect(sql).toContain("v_existing_article.source_id = v_article ->> ''sourceid''");
    expect(sql).toContain(
      "v_existing_article.normalized_title = v_article ->> ''normalizedtitle''",
    );
    expect(sql).toContain(
      "v_existing_article.content_fingerprint = v_article ->> ''contentfingerprint''",
    );
    expect(sql).toContain("set title = v_article ->> ''title''");
    expect(sql).toContain("excerpt = v_article ->> ''excerpt''");
  });

  it("근거·주제·게시 계보가 생긴 기사는 갱신하지 않고 권한을 재확정한다", () => {
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
