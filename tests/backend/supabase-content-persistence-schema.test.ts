import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202608130003_content_persistence_rpcs.sql",
  ),
  "utf8",
);

describe("Supabase content persistence migration", () => {
  it("명시적 transaction의 forward migration으로 두 server-only RPC를 만든다", () => {
    expect(sql.trimStart()).toMatch(/^--[\s\S]*?\nbegin;/);
    expect(sql.trimEnd()).toMatch(/commit;$/);
    expect(sql).toContain("create function public.persist_collected_content(");
    expect(sql).toContain("create function public.persist_selected_topic(");
    expect(sql).toContain("create function public.persist_empty_topic_selection(");
    expect(sql.match(/security definer/g)).toHaveLength(3);
    expect(sql.match(/set search_path = pg_catalog, news_clipping_private/g)).toHaveLength(3);
    expect(sql).not.toMatch(/drop\s+(table|schema|function)/i);
  });

  it("DB 시각·row lock·lease token/fence/revision/current stage를 두 RPC에서 검사한다", () => {
    expect(sql.match(/clock_timestamp\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/from news_clipping_private\.daily_runs[\s\S]{0,100}for update/g)).toHaveLength(3);
    expect(
      sql.match(
        /from news_clipping_private\.daily_runs[\s\S]{0,100}for update;\s+v_now := clock_timestamp\(\);/g,
      ),
    ).toHaveLength(3);
    expect(sql).not.toContain("v_now timestamptz := clock_timestamp()");
    for (const contract of [
      "LEASE_TOKEN_MISMATCH",
      "FENCE_MISMATCH",
      "STALE_JOURNAL_REVISION",
      "LEASE_EXPIRED",
      "ACTIVE_JOURNAL_REQUIRED",
    ]) {
      expect(sql.match(new RegExp(contract, "g"))?.length).toBeGreaterThanOrEqual(3);
    }
    expect(sql).toContain("is distinct from 'collect'");
    expect(sql).toContain("is distinct from 'score'");
    expect(sql).toContain("p_current_stage is distinct from 'collect'");
    expect(sql.match(/p_current_stage is distinct from 'score'/g)).toHaveLength(2);
  });

  it("후보 없음은 topic row 없이 exact none artifact만 put-once 저장한다", () => {
    expect(sql).toContain("create function public.persist_empty_topic_selection(");
    expect(sql).toContain("'outcome', 'none', 'candidate', null, 'evidenceItems', '[]'::jsonb");
    expect(sql).toContain("where run_date = p_run_date or run_id = p_run_id");
    expect(sql).toContain("'outcome', 'none'");
  });

  it("수집 domain rows와 collect artifact를 한 함수 본문에 저장하고 exact payload를 결속한다", () => {
    expect(sql).toContain("insert into news_clipping_private.sources");
    expect(sql).toContain("insert into news_clipping_private.articles");
    expect(sql).toContain("insert into news_clipping_private.evidence_items");
    expect(sql).toContain("p_artifact_payload #> '{value,articles}' is distinct from p_articles");
    expect(sql).toContain("p_artifact_payload #> '{value,evidenceItems}' is distinct from p_evidence_items");
    expect(sql).toContain("p_run_id, 'collect', 'news_ingestion'");
    expect(sql).toContain("'articleIdMapping', v_article_mapping");
    expect(sql).toContain("'evidenceIdMapping', v_evidence_mapping");
  });

  it("identity 충돌은 survivor를 묵시적으로 바꾸지 않고 전체 실패한다", () => {
    expect(sql).toContain("canonical_url_hash = v_article ->> 'canonicalUrlHash'");
    expect(sql).toContain("content_fingerprint = v_article ->> 'contentFingerprint'");
    expect(sql).toContain("message = 'ARTICLE_IDENTITY_CONFLICT'");
    expect(sql).toContain("message = 'EVIDENCE_IDENTITY_CONFLICT'");
    expect(sql).toContain("'storedArticleId', v_article ->> 'articleId'");
    expect(sql).toContain("'storedEvidenceId', v_evidence ->> 'evidenceId'");
  });

  it("동일 ID 재실행은 registry·article·evidence의 모든 저장 필드를 불변으로 검사한다", () => {
    expect(sql).toContain("v_existing_source.registry_payload is distinct from v_source");
    expect(sql).toContain("on conflict (id) do nothing");
    for (const comparison of [
      "v_existing_article.original_url is distinct from v_article ->> 'originalUrl'",
      "v_existing_article.title is distinct from v_article ->> 'title'",
      "v_existing_article.published_at is distinct from (v_article ->> 'publishedAt')::timestamptz",
      "v_existing_article.discovered_at is distinct from (v_article ->> 'discoveredAt')::timestamptz",
      "v_existing_article.origin_type is distinct from v_article ->> 'originType'",
      "v_existing_evidence.source_role is distinct from v_evidence ->> 'sourceRole'",
      "v_existing_evidence.authority is distinct from v_evidence ->> 'authority'",
      "v_existing_evidence.url is distinct from v_evidence ->> 'url'",
      "v_existing_evidence.published_at is distinct from (v_evidence ->> 'publishedAt')::timestamptz",
      "v_existing_evidence.locator is distinct from v_evidence ->> 'locator'",
    ]) {
      expect(sql).toContain(comparison);
    }
  });

  it("evidence 발행 시각을 article과 결속하고 직접 사실 권위의 승격을 차단한다", () => {
    expect(sql).toContain(
      "(v_evidence ->> 'publishedAt')::timestamptz is distinct from v_existing_article.published_at",
    );
    expect(sql).toContain(
      "v_evidence ->> 'publishedAtPrecision' is distinct from v_existing_article.published_at_precision",
    );
    expect(sql).toContain(
      "v_existing_source.registry_payload ->> 'authority' is distinct from 'public_authority_direct_fact'",
    );
    expect(sql).toContain("v_evidence ->> 'locator' = 'RSS 요약'");
  });

  it("선정 topic/relations/score artifact를 collect parent와 같은 transaction에 묶는다", () => {
    expect(sql).toContain("insert into news_clipping_private.topics");
    expect(sql).toContain("insert into news_clipping_private.topic_articles");
    expect(sql).toContain("insert into news_clipping_private.topic_evidence");
    expect(sql).toContain("p_run_id, 'score', 'topic_selection'");
    expect(sql).toContain("array[p_collect_output_reference], p_artifact_payload");
    expect(sql).toContain("v_collect_artifact.output_reference is distinct from p_collect_output_reference");
    expect(sql).toContain("jsonb_array_elements(v_collect_artifact.payload #> '{value,articles}')");
    expect(sql).toContain("<@ (v_collect_artifact.payload #> '{value,evidenceItems}')");
    expect(sql).toContain("order by article.published_at desc, article.id asc");
    expect(sql).toContain("message = 'TOPIC_TITLE_MISMATCH'");
    expect(sql).toContain("value = any(v_new_fact_evidence_ids)");
    expect(sql).not.toContain("any(\n      select array_agg");
  });

  it("직접 mutation과 공개 RPC 실행을 차단하고 service_role에는 RPC만 부여한다", () => {
    for (const table of [
      "sources",
      "articles",
      "evidence_items",
      "topics",
      "topic_articles",
      "topic_evidence",
    ]) {
      expect(sql).toMatch(
        new RegExp(`revoke [^;]+ on news_clipping_private\\.${table} from service_role;`),
      );
    }
    expect(sql.match(/from public, anon, authenticated;/g)).toHaveLength(3);
    expect(sql.match(/grant execute on function public\.persist_/g)).toHaveLength(3);
    expect(sql).not.toMatch(/insert\s+into\s+news_clipping_private\.model_calls/i);
  });
});
