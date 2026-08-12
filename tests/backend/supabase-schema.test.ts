import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/202608130001_news_clipping_core.sql",
    import.meta.url,
  ),
);
const sql = readFileSync(migrationPath, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ").toLowerCase();

describe("Supabase news clipping schema migration", () => {
  it("is forward-only and creates every required persistence boundary", () => {
    expect(normalizedSql).not.toMatch(/\bdrop\s+(table|schema|function|policy|index)\b/);
    expect(normalizedSql).toMatch(/^--[\s\S]*\bbegin; /);
    expect(normalizedSql).toMatch(/ commit;\s*$/);
    for (const table of [
      "sources",
      "articles",
      "evidence_items",
      "topics",
      "posts",
      "post_revisions",
      "post_sources",
      "daily_runs",
      "pipeline_artifacts",
      "model_calls",
    ]) {
      expect(normalizedSql).toContain(
        `create table news_clipping_private.${table}`,
      );
    }
    expect(normalizedSql).toContain("create table public.published_posts");
  });

  it("enforces date/slug uniqueness, immutable audits and referential lineage", () => {
    expect(normalizedSql).toMatch(/publication_date_kst date not null unique/);
    expect(normalizedSql).toMatch(/slug text not null unique/);
    expect(normalizedSql).toContain("post_revisions_are_immutable");
    expect(normalizedSql).toContain("pipeline_artifacts_are_immutable");
    expect(normalizedSql).toContain("pipeline_artifact_parents_are_immutable");
    expect(normalizedSql).toContain("model_calls_are_immutable");
    expect(normalizedSql).toContain("evidence_article_source_fk");
    expect(normalizedSql).toContain("post_source_evidence_fk");
    expect(normalizedSql).toContain(
      "from news_clipping_private.topic_evidence where topic_id = p_topic_id and evidence_id = v_source_id",
    );
    expect(normalizedSql).toContain("pipeline_artifact_lineage_guard");
    expect(normalizedSql).toContain(
      "hashtextextended(jsonb_build_array(new.run_id, new.stage)::text, 0)",
    );
    expect(normalizedSql).not.toContain("chr(0)");
    expect(normalizedSql).toContain("invalid_artifact_lineage");
    expect(normalizedSql).toContain("output_conflict");
    expect(normalizedSql).toContain(
      "or (new.stage = 'validate' and new.kind = 'publication')",
    );
    expect(normalizedSql).toContain("when 'validate' then 'generate'");
    expect(normalizedSql).toContain(
      "new.payload #>> '{value,generationoutputreference}'",
    );
  });

  it("exposes published-only rows and grants no private read to browser roles", () => {
    expect(normalizedSql).toContain("check (status = 'published')");
    expect(normalizedSql).toContain("create policy published_posts_read_only");
    expect(normalizedSql).toContain("to anon, authenticated using (status = 'published')");
    expect(normalizedSql).toContain(
      "revoke all on all tables in schema news_clipping_private from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant select on public.published_posts to anon, authenticated, service_role",
    );
    expect(normalizedSql).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[^;]+news_clipping_private[^;]+to\s+(?:anon|authenticated)/,
    );
  });

  it("defines server-time fenced daily RPCs and an atomic publish RPC", () => {
    for (const fn of [
      "acquire_daily_run",
      "checkpoint_daily_run",
      "finish_daily_run",
      "get_daily_run",
      "publish_post",
    ]) {
      expect(normalizedSql).toContain(`create function public.${fn}`);
    }
    expect(normalizedSql.match(/security definer/g)?.length).toBe(7);
    expect(normalizedSql).toContain("clock_timestamp()");
    expect(normalizedSql).toContain("for update");
    expect(normalizedSql).toContain("lease_token_mismatch");
    expect(normalizedSql).toContain("fence_mismatch");
    expect(normalizedSql).toContain("stale_journal_revision");
    expect(normalizedSql).toContain("lease_expired");
    expect(normalizedSql).toContain("duplicate_publication_date");
    expect(normalizedSql).toContain("slug_conflict");
    expect(normalizedSql).toContain(
      "v_validate_step ->> 'status' <> 'succeeded'",
    );
    expect(normalizedSql).toContain(
      "v_validate_step ->> 'outputreference' is distinct from p_validation_output_reference",
    );
    expect(normalizedSql).toContain(
      "v_validation_artifact.payload #> '{value,post}' is distinct from p_post",
    );
    expect(normalizedSql).toContain(
      "v_validation_artifact.payload #> '{value,qualityresult,passed}' is distinct from 'true'::jsonb",
    );
    expect(normalizedSql).toContain(
      "v_validation_artifact.stage <> 'validate'",
    );
    expect(normalizedSql).toContain(
      "v_validation_artifact.kind <> 'publication'",
    );
    expect(normalizedSql).toContain(
      "(v_validation_artifact.payload #>> '{value,generationoutputreference}') = any(v_validation_artifact.parent_output_references)",
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.acquire_daily_run(date, jsonb, jsonb, timestamptz) to service_role",
    );
  });

  it("keeps security-definer search paths fixed and documents the projection contract", () => {
    const definerFunctions = sql.match(
      /create function public\.[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog, news_clipping_private[\s\S]*?\$\$;/gi,
    );
    expect(definerFunctions).toHaveLength(5);
    for (const column of [
      "id",
      "slug",
      "status",
      "publication_date_kst",
      "published_at",
      "modified_at",
      "title",
      "summary",
      "visual",
      "one_line_summary",
      "body",
      "questions",
      "sources",
    ]) {
      expect(normalizedSql).toMatch(
        new RegExp(`create table public\\.published_posts \\([\\s\\S]*?\\b${column}\\b`),
      );
    }
  });

  it("allows artifact parent materialization only through its fixed-path trigger", () => {
    expect(normalizedSql).toMatch(
      /create function news_clipping_private\.insert_pipeline_artifact_parent_rows\(\) returns trigger language plpgsql security definer set search_path = pg_catalog, news_clipping_private/,
    );
    expect(normalizedSql).toContain(
      "revoke all on function news_clipping_private.insert_pipeline_artifact_parent_rows() from public, anon, authenticated, service_role",
    );
    expect(normalizedSql).toContain(
      "revoke all on function news_clipping_private.validate_pipeline_artifact() from public, anon, authenticated, service_role",
    );
    expect(normalizedSql).toMatch(
      /create function news_clipping_private\.validate_pipeline_artifact\(\) returns trigger language plpgsql security definer set search_path = pg_catalog, news_clipping_private/,
    );
    expect(normalizedSql).toContain(
      "grant select on news_clipping_private.pipeline_artifact_parents to service_role",
    );
    expect(normalizedSql).not.toMatch(
      /grant\s+[^;]*insert[^;]*on\s+news_clipping_private\.pipeline_artifact_parents\s+to\s+service_role/,
    );
  });

  it("validates nested public projection fields and source references", () => {
    expect(normalizedSql).toContain(
      "create function news_clipping_private.is_valid_published_post",
    );
    expect(normalizedSql).toContain("p_post #>> '{visual,kind}' is distinct from 'pattern'");
    expect(normalizedSql).toContain("jsonb_array_length(v_paragraph -> 'claims') < 1");
    expect(normalizedSql).toContain("jsonb_array_length(v_claim -> 'sourceids') < 1");
    expect(normalizedSql).toContain("published_projection_nested_contract");
    expect(normalizedSql).toContain(
      "jsonb_typeof(v_question) is distinct from 'string'",
    );
    expect(normalizedSql).toContain(
      "(v_source ->> 'id') ~ '^[a-za-z0-9][a-za-z0-9._:-]{0,127}$', false",
    );
    expect(normalizedSql).toContain(
      "(v_source ->> 'publisheddate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'",
    );
    expect(normalizedSql).not.toContain("\\d{4}");
    expect(normalizedSql).toContain(
      "news_clipping_private.is_valid_published_post(p_post) is distinct from true",
    );
  });
});
