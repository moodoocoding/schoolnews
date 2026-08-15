import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608150039_recover_august15_run_via_lease_expiry.sql",
  "utf8",
).toLowerCase();

describe("august 15 lease-expiry recovery", () => {
  it("정확한 blocked/INVALID_SOURCE_DATA 실행만, 산출물이 없을 때만 되돌린다", () => {
    expect(sql).toContain("v_run_id constant text := 'daily-20260815'");
    expect(sql).toContain("v_run_date constant date := date '2026-08-15'");
    expect(sql).toContain("v_row.status is distinct from 'blocked'");
    expect(sql).toContain(
      "v_row.journal #>> '{terminalreason}' is distinct from 'invalid_source_data'",
    );
    for (const table of ["posts", "model_calls", "model_invocation_intents"]) {
      expect(sql).toContain(`news_clipping_private.${table}`);
    }
    expect(sql).toContain(
      "from news_clipping_private.topics\n       where run_id = v_run_id and selected is true",
    );
    expect(sql).toContain("message = 'august15_lease_recovery_refused'");
  });

  it("score 단계 모양이 정확히 예상과 같을 때만 진행한다", () => {
    expect(sql).toContain("v_score_step ->> 'stage' <> 'score'");
    expect(sql).toContain("v_score_step ->> 'status' <> 'skipped'");
    expect(sql).toContain(
      "(v_score_step ->> 'attemptnumber')::integer <> 0",
    );
    expect(sql).toContain("message = 'august15_lease_recovery_shape_mismatch'");
  });

  it("행을 삭제하지 않고 재개 가능한 running 상태로 되돌린다", () => {
    expect(sql).not.toContain("delete from");
    expect(sql).toContain("jsonb_set(v_journal, '{run,status}', '\"running\"'::jsonb)");
    expect(sql).toContain(
      "jsonb_set(v_journal, '{run,currentstage}', '\"score\"'::jsonb)",
    );
    expect(sql).toContain("jsonb_set(v_journal, '{finishedat}', 'null'::jsonb)");
    expect(sql).toContain("jsonb_set(v_journal, '{terminalreason}', 'null'::jsonb)");
    expect(sql).toContain("'attemptnumber', 1");
    expect(sql).toContain("update news_clipping_private.daily_runs set");
    expect(sql).toContain("status = 'running'");
    expect(sql).toContain("lease_expires_at = v_now - interval '1 hour'");
    expect(sql).toContain(
      "lease_acquired_at = v_now - interval '2 hours'",
    );
  });

  it("journal.revision과 journal_revision 컬럼이 갱신 전후 일치하는지 확인한다", () => {
    expect(sql).toContain(
      "if (v_journal #>> '{revision}')::integer <> v_row.journal_revision then",
    );
    expect(sql).toContain("message = 'august15_lease_recovery_revision_drift'");
  });
});
