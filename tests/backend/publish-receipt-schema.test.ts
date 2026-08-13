import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608130008_publish_receipt_reconciliation.sql",
  ),
  "utf8",
)
  .replace(/--.*$/gm, " ")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

describe("publish receipt reconciliation migration", () => {
  it("네 identity를 받는 read-only SECURITY DEFINER 함수를 고정 search_path로 만든다", () => {
    expect(migration).toContain(
      "create or replace function public.get_publish_receipt( p_run_date date, p_run_id text, p_revision_id text, p_validation_output_reference text ) returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, news_clipping_private",
    );
    expect(migration).not.toMatch(/\b(insert|update|delete|truncate)\b/);
  });

  it("publish_post와 같은 날짜 lock 뒤에 fresh snapshot으로 단 한 번 확정한다", () => {
    expect(migration).toContain(
      "perform pg_advisory_xact_lock( hashtextextended('news-clipping-daily:' || p_run_date::text, 0) )",
    );
    expect(migration.indexOf("perform pg_advisory_xact_lock")).toBeLessThan(
      migration.indexOf("select count(*) into v_related_count"),
    );
  });

  it("post·revision·validation artifact·public projection을 함께 대조하고 모순은 stable error로 닫는다", () => {
    expect(migration).toContain("from news_clipping_private.posts");
    expect(migration).toContain("from news_clipping_private.post_revisions");
    expect(migration).toContain("from news_clipping_private.pipeline_artifacts");
    expect(migration).toContain("from public.published_posts");
    expect(migration).toContain("v_revision.detail is distinct from v_public_detail");
    expect(migration).toContain(
      "v_validation.payload #> '{value,post}'",
    );
    expect(migration).toContain("message = 'publish_receipt_conflict'");
  });

  it("완전 부재만 null이고 부분 identity는 conflict로 처리한다", () => {
    expect(migration).toContain("if v_related_count = 0 then");
    expect(migration).toContain("where id = p_revision_id");
    expect(migration).toContain(
      "where output_reference = p_validation_output_reference",
    );
    expect(migration).toContain(
      "v_validation.run_id is distinct from p_run_id",
    );
    expect(migration).toContain(
      "news_clipping_private.is_valid_published_post( v_validation.payload #> '{value,post}' ) is distinct from true",
    );
    expect(migration).toContain(
      "v_validation.payload #>> '{value,post,publicationdatekst}' is distinct from p_run_date::text",
    );
    expect(migration).toContain(
      "where id = v_validation.payload #>> '{value,post,id}' or slug = v_validation.payload #>> '{value,post,slug}'",
    );
    expect(migration).toContain("return null");
    expect(migration).toContain("if v_related_count <> 1 then");
  });

  it("마이그레이션 적용을 명시적 트랜잭션으로 묶는다", () => {
    expect(migration.startsWith("begin;")).toBe(true);
    expect(migration.endsWith("commit;")).toBe(true);
  });

  it("public·anon·authenticated 실행 권한을 제거하고 service_role만 허용한다", () => {
    expect(migration).toContain(
      "revoke all on function public.get_publish_receipt(date, text, text, text) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.get_publish_receipt(date, text, text, text) to service_role",
    );
  });
});
