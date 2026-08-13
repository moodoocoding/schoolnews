import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/202608130017_archive_current_august_posts.sql",
);

describe("현재 8월 게시물 불변 아카이브 migration", () => {
  it("8월 1~13일 공개 projection을 별도 테이블로 스냅샷한다", async () => {
    const sql = (await readFile(migrationPath, "utf8")).toLowerCase();

    expect(sql).toContain("create table public.published_post_archive");
    expect(sql).toContain("insert into public.published_post_archive");
    expect(sql).toContain("from public.published_posts");
    expect(sql).toContain(
      "where publication_date_kst between date '2026-08-01' and date '2026-08-13'",
    );
    expect(sql).toContain("'august-2026-original'");
  });

  it("수정·삭제을 trigger로 거부하고 공개 역할에는 SELECT만 허용한다", async () => {
    const sql = (await readFile(migrationPath, "utf8")).toLowerCase();

    expect(sql).toContain("before update or delete on public.published_post_archive");
    expect(sql).toContain("reject_immutable_row_mutation()");
    expect(sql).toContain("alter table public.published_post_archive force row level security");
    expect(sql).toContain("create policy published_post_archive_read_only");
    expect(sql).toContain("revoke all on public.published_post_archive");
    expect(sql).toContain("grant select on public.published_post_archive");
    expect(sql).not.toMatch(/grant\s+(insert|update|delete)/);
  });
});

