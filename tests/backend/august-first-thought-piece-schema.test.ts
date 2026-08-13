import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve("supabase/migrations/202608130016_revise_august_first_thought_piece.sql"), "utf8").toLowerCase();

describe("8월 1일 AI·디지털 교육 생각거리 교정 RPC", () => {
  it("국내 출처를 유지하고 3문단·600~700자로 좁힌다", () => {
    expect(sql).toContain("jsonb_array_length(p_post -> 'body') <> 3");
    expect(sql).toContain("v_body_length not between 600 and 700");
    expect(sql).toContain("www.hangyo.com");
    expect(sql).toContain("www.news1.kr");
    expect(sql).not.toContain("govtech.com");
    expect(sql).toContain("revise_august_first_thought_piece");
  });

  it("기존 post를 덮어쓰지 않고 불변 revision을 추가한다", () => {
    expect(sql).toContain("insert into news_clipping_private.post_revisions");
    expect(sql).toContain("p_expected_active_revision_id");
    expect(sql).toContain("security definer");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
  });
});
