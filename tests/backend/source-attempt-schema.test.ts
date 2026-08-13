import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/202608130006_source_collection_attempt_reservations.sql",
);
const sql = readFileSync(migrationPath, "utf8")
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

describe("source collection attempt migration", () => {
  it("source별 마지막 요청 시각을 private 테이블에 보존한다", () => {
    expect(sql.startsWith("begin;")).toBe(true);
    expect(sql.endsWith("commit;")).toBe(true);
    expect(sql).toContain(
      "create table if not exists news_clipping_private.source_collection_attempts",
    );
    expect(sql).toContain("source_id text primary key");
    expect(sql).toContain("last_attempt_at timestamptz not null");
    expect(sql).toContain("source_collection_policies");
    expect(sql).toContain("values ('msit-press-release', 86400000)");
    expect(sql).toContain("p_min_interval_ms <> v_policy_interval_ms");
    expect(sql).toContain(
      "alter table news_clipping_private.source_collection_attempts force row level security",
    );
  });

  it("source advisory lock과 row lock 뒤 서버 시각을 한 번 읽는다", () => {
    const advisory = sql.indexOf("pg_advisory_xact_lock(");
    const rowLock = sql.indexOf("for update;");
    const clock = sql.indexOf("v_now := clock_timestamp();");

    expect(advisory).toBeGreaterThan(0);
    expect(rowLock).toBeGreaterThan(advisory);
    expect(clock).toBeGreaterThan(rowLock);
    expect(sql.match(/clock_timestamp\(\)/g)).toHaveLength(1);
  });

  it("너무 이른 요청은 TOO_SOON이고 허용 요청만 last_attempt_at을 갱신한다", () => {
    const tooSoon = sql.indexOf("'code', 'too_soon'");
    const insert = sql.indexOf(
      "insert into news_clipping_private.source_collection_attempts",
    );
    expect(sql).toContain("'status', 'too_soon'");
    expect(sql).toContain("'code', 'too_soon'");
    expect(tooSoon).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(tooSoon);
    expect(sql).toContain("on conflict (source_id) do update");
  });

  it("고정 search_path의 SECURITY DEFINER를 service_role에만 허용한다", () => {
    expect(sql).toContain("security definer set search_path = pg_catalog, news_clipping_private");
    expect(sql).toContain(
      "revoke all on function public.reserve_source_collection_attempt(text, bigint) from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.reserve_source_collection_attempt(text, bigint) to service_role",
    );
    expect(sql).toContain(
      "revoke all on news_clipping_private.source_collection_attempts from public, anon, authenticated, service_role",
    );
  });
});
