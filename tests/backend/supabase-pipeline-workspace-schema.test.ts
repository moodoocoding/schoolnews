import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/202608130002_pipeline_workspace_rpcs.sql",
    import.meta.url,
  ),
);
const sql = readFileSync(migrationPath, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("Supabase pipeline workspace RPC migration", () => {
  it("forward-only migration으로 세 서버 전용 RPC를 추가한다", () => {
    expect(normalizedSql).not.toMatch(
      /\bdrop\s+(table|schema|function|policy|index)\b/,
    );
    expect(normalizedSql).toMatch(/^--[\s\S]*\bbegin; /);
    expect(normalizedSql).toMatch(/ commit;\s*$/);
    for (const functionName of [
      "put_pipeline_artifact",
      "get_pipeline_artifact",
      "get_pipeline_artifact_for_stage",
    ]) {
      expect(normalizedSql).toContain(
        `create function public.${functionName}`,
      );
    }
  });

  it("put에서 서버 시각 lease와 run·token·fence·revision·현재 단계를 모두 검사한다", () => {
    expect(normalizedSql).toContain("v_now timestamptz");
    expect(normalizedSql).toContain("where run_date = p_run_date for update");
    expect(normalizedSql).toContain("v_now := clock_timestamp()");
    expect(normalizedSql.indexOf("v_now := clock_timestamp()")).toBeGreaterThan(
      normalizedSql.indexOf("where run_date = p_run_date for update"),
    );
    expect(normalizedSql).toContain("v_run.run_id <> p_run_id");
    expect(normalizedSql).toContain("v_run.lease_token <> p_lease_token");
    expect(normalizedSql).toContain("v_run.fence <> p_fence");
    expect(normalizedSql).toContain(
      "v_run.journal_revision <> p_expected_revision",
    );
    expect(normalizedSql).toContain(
      "v_run.lease_expires_at is null or v_run.lease_expires_at <= v_now",
    );
    expect(normalizedSql).toContain("v_run.status <> 'running'");
    expect(normalizedSql).toContain(
      "v_run.journal #>> '{run,currentstage}' is distinct from p_stage",
    );
    expect(normalizedSql).not.toContain("p_requested_now");
  });

  it("단계-kind와 정렬된 exact 부모 계보를 강제한다", () => {
    expect(normalizedSql).not.toContain(
      "(p_stage = 'collect' and p_kind = 'news_ingestion')",
    );
    expect(normalizedSql).not.toContain(
      "(p_stage = 'score' and p_kind = 'topic_selection')",
    );
    expect(normalizedSql).toContain(
      "(p_stage = 'generate' and p_kind = 'post_generation')",
    );
    expect(normalizedSql).toContain(
      "(p_stage = 'validate' and p_kind = 'publication')",
    );
    expect(normalizedSql).toContain(
      "p_payload ->> 'kind' is distinct from p_kind",
    );
    expect(normalizedSql).toContain(
      "array_agg(output_reference order by output_reference)",
    );
    expect(normalizedSql).toContain(
      "p_parent_output_references is distinct from v_sorted_parents",
    );
    expect(normalizedSql).toContain(
      "cardinality(p_parent_output_references) <> 1",
    );
    expect(normalizedSql).toContain(
      "p_payload #>> '{value,generationoutputreference}' is distinct from p_parent_output_references[1]",
    );
    expect(normalizedSql).toContain("v_parent.stage <> 'generate'");
    expect(normalizedSql).toContain("v_parent.kind <> 'post_generation'");
    expect(normalizedSql).toContain(
      "v_parent.payload #>> '{value,status}' is distinct from 'validated'",
    );
    expect(normalizedSql).toContain(
      "p_payload #> '{value,qualityresult}' is distinct from v_parent.payload #> '{value,qualityresult}'",
    );
    expect(normalizedSql).toContain("message = 'invalid_artifact_lineage'");
  });

  it("동일 재요청만 created=false로 반환하고 다른 결과는 충돌시킨다", () => {
    expect(normalizedSql).toContain(
      "where run_id = p_run_id and stage = p_stage",
    );
    for (const comparison of [
      "v_existing.kind is distinct from p_kind",
      "v_existing.output_reference is distinct from p_output_reference",
      "v_existing.payload_fingerprint is distinct from p_payload_fingerprint",
      "v_existing.configuration_fingerprint is distinct from p_configuration_fingerprint",
      "v_existing.parent_output_references is distinct from p_parent_output_references",
      "v_existing.payload is distinct from p_payload",
    ]) {
      expect(normalizedSql).toContain(comparison);
    }
    expect(normalizedSql).toContain("'created', false");
    expect(normalizedSql).toContain("'created', true");
    expect(normalizedSql).toContain("message = 'output_conflict'");
  });

  it("private 직접 권한을 제거하고 service_role에 RPC 실행만 허용한다", () => {
    expect(normalizedSql).toContain(
      "revoke select, insert on news_clipping_private.pipeline_artifacts from service_role",
    );
    expect(normalizedSql).toContain(
      "revoke select on news_clipping_private.pipeline_artifact_parents from service_role",
    );
    for (const functionName of [
      "public.put_pipeline_artifact",
      "public.get_pipeline_artifact",
      "public.get_pipeline_artifact_for_stage",
    ]) {
      expect(normalizedSql).toMatch(
        new RegExp(
          `revoke all on function ${functionName.replace(".", "\\.")}\\([^;]+from public, anon, authenticated`,
        ),
      );
      expect(normalizedSql).toMatch(
        new RegExp(
          `grant execute on function ${functionName.replace(".", "\\.")}\\([^;]+to service_role`,
        ),
      );
    }
  });

  it("모든 public RPC는 SECURITY DEFINER와 고정 search_path를 사용한다", () => {
    const publicFunctions = sql.match(
      /create function public\.[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog, news_clipping_private[\s\S]*?\$\$;/gi,
    );
    expect(publicFunctions).toHaveLength(3);
  });
});
