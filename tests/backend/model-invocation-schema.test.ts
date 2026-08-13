import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/202608130007_model_invocation_ledger.sql",
    import.meta.url,
  ),
  "utf8",
);
const normalized = sql.replace(/\s+/g, " ").toLowerCase();

describe("Supabase model invocation ledger migration", () => {
  it("명시적 forward transaction과 private put-once ledger를 만든다", () => {
    expect(normalized).toMatch(/^--[\s\S]* begin; /);
    expect(normalized).toMatch(/ commit;\s*$/);
    expect(normalized).toContain(
      "create table news_clipping_private.model_invocation_intents",
    );
    expect(normalized).toContain(
      "unique (run_id, purpose, attempt_number, route_attempt)",
    );
    expect(normalized).toContain("status in ('reserved', 'completed')");
    expect(normalized).toContain("model_invocation_intents_are_put_once");
    expect(normalized).not.toMatch(/drop\s+(table|schema|function)/);
  });

  it("prepare/finalize는 잠금 뒤 서버 시각과 lease CAS를 검사한다", () => {
    for (const name of ["prepare_model_invocation", "finalize_model_invocation"]) {
      const start = normalized.indexOf(`create function public.${name}`);
      const end = normalized.indexOf(" $$;", start);
      const body = normalized.slice(start, end);
      expect(body.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(0);
      expect(body.indexOf("for update")).toBeGreaterThan(
        body.indexOf("pg_advisory_xact_lock"),
      );
      expect(body.indexOf("v_now := clock_timestamp()")).toBeGreaterThan(
        body.indexOf("for update"),
      );
      for (const code of [
        "lease_token_mismatch",
        "fence_mismatch",
        "stale_journal_revision",
        "lease_expired",
        "active_journal_required",
      ]) {
        expect(body).toContain(code);
      }
      expect(body).toContain("'{run,currentstage}' is distinct from 'generate'");
    }
    expect(normalized).toContain(
      "v_intent.reserved_fence is distinct from p_fence",
    );
    expect(normalized).toContain(
      "v_intent.reserved_journal_revision is distinct from p_expected_revision",
    );
  });

  it("score 계보와 exact evidence를 결속하고 DB에서 보수 예산을 예약한다", () => {
    expect(normalized).toContain("p_score_output_reference");
    expect(normalized).toContain("where run_id = p_run_id and stage = 'score'");
    expect(normalized).toContain("v_score.kind is distinct from 'topic_selection'");
    expect(normalized).toContain(
      "v_score.payload #>> '{value,outcome}' is distinct from 'eligible'",
    );
    expect(normalized).toContain(
      "v_score_evidence_ids is distinct from p_evidence_ids",
    );
    for (const field of [
      "reserved_input_tokens",
      "reserved_output_tokens",
      "reserved_cost_usd",
    ]) {
      expect(normalized).toContain(field);
    }
    expect(normalized).toContain("'{run,limits,maxmodelcalls}'");
    expect(normalized).toContain("'{run,limits,maxinputtokens}'");
    expect(normalized).toContain("'{run,limits,maxoutputtokens}'");
    expect(normalized).toContain("'{run,limits,maxestimatedcostusd}'");
    expect(normalized).toContain("invocation_budget_exceeded");
  });

  it("reserved 재조회는 새 호출을 허용하지 않고 완료 감사만 재사용한다", () => {
    expect(normalized).toContain("'status', 'prepared'");
    expect(normalized).toContain("'status', 'reserved'");
    expect(normalized).toContain("'status', 'completed'");
    expect(normalized).toContain("where id = v_intent.id and status = 'reserved'");
    expect(normalized).toContain("get_model_invocation");
    expect(normalized).toContain("message = 'invalid_invocation_input'");
  });

  it("generate artifact가 completed audit와 exact 일치해야 하고 model call을 한 번 결속한다", () => {
    expect(normalized).toContain("validate_generation_model_audits");
    expect(normalized).toContain("v_intent.audit is distinct from v_audit");
    expect(normalized).toContain("v_intent.status is distinct from 'completed'");
    expect(normalized).toContain("invalid_model_audit_lineage");
    expect(normalized).toContain("bind_generation_model_calls");
    expect(normalized).toContain("set artifact_id = new.id");
    expect(normalized).toContain("old.artifact_id is null");
    expect(normalized).toContain(
      "'{value,usage,inputtokens}')::bigint <> v_input_tokens",
    );
    expect(normalized).toContain(
      "'{value,usage,outputtokens}')::bigint <> v_output_tokens",
    );
    expect(normalized).toContain(
      "'{value,usage,estimatedcostusd}')::numeric <> v_cost_usd",
    );
    expect(normalized).toContain("new.artifact_id is not null");
  });

  it("audit JSON을 cast 전에 fail-closed 검증하고 unpriced 호출을 거부한다", () => {
    expect(normalized).toContain("jsonb_typeof(p_audit) is distinct from 'object'");
    expect(normalized).toContain("p_audit ?& array[");
    expect(normalized).toContain("jsonb_typeof(p_audit -> 'usage') is distinct from 'object'");
    expect(normalized).toContain("p_audit -> 'estimatedcostusd' = 'null'::jsonb");
    expect(normalized).toContain("invalid_invocation_audit");
  });

  it("private direct DML과 public 호출을 차단하고 service_role에는 RPC만 준다", () => {
    for (const table of [
      "model_calls",
      "model_call_evidence",
      "model_invocation_intents",
    ]) {
      expect(normalized).toMatch(
        new RegExp(`revoke [^;]+ on news_clipping_private\\.${table}[^;]+service_role`),
      );
    }
    for (const rpc of [
      "prepare_model_invocation",
      "finalize_model_invocation",
      "get_model_invocation",
    ]) {
      expect(normalized).toMatch(
        new RegExp(`revoke all on function public\\.${rpc}\\([^;]+public, anon, authenticated`),
      );
      expect(normalized).toMatch(
        new RegExp(`grant execute on function public\\.${rpc}\\([^;]+service_role`),
      );
    }
  });
});
