import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608160044_retry_august16_score_after_contract_fix.sql",
  "utf8",
).toLowerCase();

describe("august 16 score retry after contract fix", () => {
  it("043이 남긴 정확한 running 상태만, 산출물이 없을 때만 되돌린다", () => {
    expect(sql).toContain("v_run_id constant text := 'daily-20260816'");
    expect(sql).toContain("v_run_date constant date := date '2026-08-16'");
    expect(sql).toContain("v_row.status is distinct from 'running'");
    expect(sql).toContain("v_score_step ->> 'status' <> 'running'");
    expect(sql).toContain("(v_score_step ->> 'attemptnumber')::integer <> 1");
    for (const table of ["posts", "model_calls", "model_invocation_intents"]) {
      expect(sql).toContain(`news_clipping_private.${table}`);
    }
    expect(sql).toContain("message = 'august16_score_retry_refused'");
    expect(sql).toContain("message = 'august16_score_retry_shape_mismatch'");
  });

  it("시도 기록을 다시 쓰지 않고 실제 1회차 실패 정보를 재사용한다", () => {
    // journal.attempts must stay untouched so the audit trail keeps the real
    // first failure; only the step is moved to its retryable shape.
    expect(sql).not.toContain("'{attempts");
    expect(sql).toContain("from jsonb_array_elements(v_row.journal -> 'attempts')");
    expect(sql).toContain("message = 'august16_score_retry_attempt_missing'");
    expect(sql).toContain("'status', 'failed_retryable'");
    expect(sql).toContain("'finishedat', v_score_attempt -> 'finishedat'");
    expect(sql).toContain("'errorcode', v_score_attempt -> 'errorcode'");
  });

  it("행을 삭제하지 않고 lease만 만료시켜 정상 재시도 경로를 태운다", () => {
    expect(sql).not.toContain("delete from");
    // The run must stay 'running'; leaving no step in 'running' status is what
    // makes the stage loop retry score instead of the interrupted-step path.
    expect(sql).not.toContain("'{run,status}'");
    expect(sql).toContain("lease_expires_at = v_now - interval '1 hour'");
    expect(sql).toContain("update news_clipping_private.daily_runs set");
  });
});
