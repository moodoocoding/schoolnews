import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608130022_private_full_text_ingestion.sql",
  "utf8",
).toLowerCase();

describe("private 기사 원문 schema", () => {
  it("명시적 매체 정책과 보존 기한이 있는 private-only 테이블을 만든다", () => {
    expect(sql).toContain("news_clipping_private.source_full_text_policies");
    expect(sql).toContain("full_text_use_allowed boolean not null");
    expect(sql).toContain("news_clipping_private.article_full_texts");
    expect(sql).toContain("retention_until");
    expect(sql).toContain("article_full_text_retention_limit");
    expect(sql).toContain("extensions.digest(v_item ->> 'bodytext', 'sha256')");
    expect(sql).toContain("v_now + make_interval(days => v_policy.retention_days)");
    expect(sql).toContain("jsonb_path_exists");
    expect(sql).not.toContain("create table public.article_full_texts");
  });

  it("직접 권한을 모두 제거하고 server-only RPC만 허용한다", () => {
    expect(sql).toContain("force row level security");
    expect(sql).toContain("revoke all on news_clipping_private.article_full_texts");
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete)\s+on\s+news_clipping_private\.article_full_texts/);
    expect(sql).toContain("grant execute on function public.persist_article_full_texts");
    expect(sql).toContain("to service_role");
  });

  it("쓰기 RPC가 lease·fence·exact collect artifact와 등록 정책을 확인한다", () => {
    expect(sql).toContain("fence_mismatch");
    expect(sql).toContain("stale_journal_revision");
    expect(sql).toContain("lease_expired");
    expect(sql).toContain("collect_artifact_required");
    expect(sql).toContain("full_text_permission_required");
    expect(sql).toContain("jsonb_array_length(p_full_texts) < 1");
    expect(sql).toContain("source_full_text_policies");
    expect(sql).toContain("article_full_texts_are_immutable");
    expect(sql).toMatch(/before update on news_clipping_private\.article_full_texts/);
  });

  it("읽기 RPC는 보존 기한이 남은 본문만 서버에 반환한다", () => {
    expect(sql).toContain("create function public.get_selected_article_full_texts");
    expect(sql).toContain("body.retention_until > v_now");
    expect(sql).toContain("selected_topic_required");
    expect(sql).toContain("full_text_coverage_required");
    expect(sql).toContain("journal #>> '{run,currentstage}' is distinct from 'generate'");
    expect(sql).toContain("revoke all on function public.get_selected_article_full_texts");
    expect(sql).toContain("'permission', body.permission_snapshot");
    expect(sql).toContain("'finalurl', body.final_url");
  });

  it("보존 기한이 지난 행만 제한된 service-role RPC로 삭제한다", () => {
    expect(sql).toContain("create function public.purge_expired_article_full_texts");
    expect(sql).toContain("retention_until <= statement_timestamp()");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("grant execute on function public.purge_expired_article_full_texts");
    expect(sql).not.toMatch(/grant\s+delete\s+on\s+news_clipping_private\.article_full_texts/);
  });
});
