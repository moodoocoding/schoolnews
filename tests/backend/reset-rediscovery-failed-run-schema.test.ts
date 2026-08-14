import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608140030_reset_rediscovery_failed_run.sql",
  "utf8",
).toLowerCase();

describe("rediscovery failure recovery", () => {
  it("내구 출력이 없는 정확한 실패 실행만 제거한다", () => {
    expect(sql).toContain("v_run_id constant text := 'daily-20260814'");
    expect(sql).toContain("v_run_date constant date := date '2026-08-14'");
    expect(sql).toContain("v_status is distinct from 'failed'");
    for (const table of [
      "posts",
      "topics",
      "pipeline_artifacts",
      "model_calls",
      "model_invocation_intents",
    ]) {
      expect(sql).toContain(`news_clipping_private.${table}`);
    }
    expect(sql).toContain("message = 'rediscovery_failed_run_reset_refused'");
    expect(sql).toContain("delete from news_clipping_private.daily_runs");
  });
});
