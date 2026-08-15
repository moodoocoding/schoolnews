import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608150041_recover_august15_run_after_reuse_check.sql",
  "utf8",
).toLowerCase();

describe("august 15 post-reuse-check recovery", () => {
  it("정확한 blocked/PIPELINE_VERSION_MISMATCH 실행만, 산출물이 없을 때만 되돌린다", () => {
    expect(sql).toContain("v_run_id constant text := 'daily-20260815'");
    expect(sql).toContain("v_run_date constant date := date '2026-08-15'");
    expect(sql).toContain("v_row.status is distinct from 'blocked'");
    expect(sql).toContain(
      "v_row.journal #>> '{terminalreason}' is distinct from 'pipeline_version_mismatch'",
    );
    for (const table of ["posts", "model_calls", "model_invocation_intents"]) {
      expect(sql).toContain(`news_clipping_private.${table}`);
    }
    expect(sql).toContain("message = 'august15_reuse_recovery_refused'");
  });

  it("score 단계가 정확히 실패한(attemptNumber 1) 모양일 때만 진행한다", () => {
    expect(sql).toContain("v_score_step ->> 'status' <> 'failed'");
    expect(sql).toContain(
      "(v_score_step ->> 'attemptnumber')::integer <> 1",
    );
    expect(sql).toContain("message = 'august15_reuse_recovery_shape_mismatch'");
  });

  it("행을 삭제하지 않고 재개 가능한 running 상태로 되돌린다", () => {
    expect(sql).not.toContain("delete from");
    expect(sql).toContain("jsonb_set(v_journal, '{run,status}', '\"running\"'::jsonb)");
    expect(sql).toContain("update news_clipping_private.daily_runs set");
    expect(sql).toContain("status = 'running'");
    expect(sql).toContain("lease_expires_at = v_now - interval '1 hour'");
  });
});
