import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608140037_reset_august14_run_for_score_diagnosis.sql",
  "utf8",
).toLowerCase();

describe("august 14 score-diagnosis failure recovery", () => {
  it("선택된 주제·발행·모델 산출물이 없는 정확한 blocked 실행만 제거한다", () => {
    expect(sql).toContain("v_run_id constant text := 'daily-20260814'");
    expect(sql).toContain("v_run_date constant date := date '2026-08-14'");
    expect(sql).toContain("v_status is distinct from 'blocked'");
    expect(sql).toContain(
      "from news_clipping_private.topics\n       where run_id = v_run_id and selected is true",
    );
    for (const table of ["posts", "model_calls", "model_invocation_intents"]) {
      expect(sql).toContain(`news_clipping_private.${table}`);
    }
    // The completed collect artifact is intentionally kept so the next
    // attempt can reuse it, unlike the earlier 034-036 resets.
    expect(sql).not.toContain("pipeline_artifacts");
    expect(sql).toContain(
      "message = 'august14_score_diagnosis_reset_refused'",
    );
    expect(sql).toContain("delete from news_clipping_private.daily_runs");
  });
});
