import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608140025_rolling_editorial_materials.sql"),
  "utf8",
).replace(/\s+/g, " ").toLowerCase();

describe("rolling editorial materials migration", () => {
  it("직전 1~7일만 KST 기준으로 읽고 evidence-use 출처만 허용한다", () => {
    expect(sql).toContain("p_window_days not between 1 and 7");
    expect(sql).toContain("at time zone 'asia/seoul'");
    expect(sql).toContain("p_run_date - p_window_days");
    expect(sql).toContain("< p_run_date");
    expect(sql).toContain("registry_payload ->> 'contentuse' = 'evidence'");
  });

  it("최신 발행일을 history 응답에 포함한다", () => {
    expect(sql).toContain("'latestpublicationdatekst'");
    expect(sql).toContain("max(publication_date_kst)");
  });

  it("service role만 호출하고 한 transaction으로 배포한다", () => {
    expect(sql).toContain("security definer set search_path = pg_catalog, news_clipping_private");
    expect(sql).toContain("revoke all on function public.get_rolling_editorial_materials(date, integer) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.get_rolling_editorial_materials(date, integer) to service_role");
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });
});
