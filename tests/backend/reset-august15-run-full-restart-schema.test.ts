import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608150040_reset_august15_run_full_restart.sql",
  "utf8",
).toLowerCase();

describe("august 15 full-restart failure recovery", () => {
  it("내구 출력이 없는 정확한 blocked 실행과 그 collect artifact만 제거한다", () => {
    expect(sql).toContain("v_run_id constant text := 'daily-20260815'");
    expect(sql).toContain("v_run_date constant date := date '2026-08-15'");
    expect(sql).toContain("v_status is distinct from 'blocked'");
    for (const table of ["posts", "model_calls", "model_invocation_intents"]) {
      expect(sql).toContain(`news_clipping_private.${table}`);
    }
    expect(sql).toContain(
      "from news_clipping_private.topics\n       where run_id = v_run_id and selected is true",
    );
    expect(sql).toContain(
      "delete from news_clipping_private.pipeline_artifacts",
    );
    expect(sql).toContain("message = 'august15_full_restart_reset_refused'");
    expect(sql).toContain("delete from news_clipping_private.daily_runs");
  });
});
