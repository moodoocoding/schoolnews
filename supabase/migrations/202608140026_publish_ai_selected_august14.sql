-- One-time AI-selected publication for the 2026-08-14 cadence bootstrap.
-- The normal daily run completed before the new seven-day policy was live.
-- This date-locked boundary preserves that immutable journal while recording
-- the AI-selected domestic sources and article in the normal public tables.
begin;

create or replace function public.publish_ai_selected_august14(
  p_post jsonb,
  p_sources jsonb,
  p_ai_audit jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_run news_clipping_private.daily_runs%rowtype;
  v_now timestamptz;
  v_topic_id text := 'ai-editorial-topic-20260814';
  v_revision_id text := 'ai-editorial-revision-20260814-v1';
  v_detail jsonb;
  v_item jsonb;
  v_source_id text;
  v_article_id text;
  v_index integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:2026-08-14', 0));
  v_now := clock_timestamp();
  if (v_now at time zone 'Asia/Seoul')::date <> date '2026-08-14'
     or (v_now at time zone 'Asia/Seoul')::time < time '03:00:00'
     or jsonb_typeof(p_sources) is distinct from 'array'
     or jsonb_array_length(p_sources) not between 2 and 3
     or jsonb_typeof(p_ai_audit) is distinct from 'object'
     or p_ai_audit ->> 'providerId' <> 'google-gemini'
     or p_ai_audit ->> 'modelId' not in ('gemini-3.6-flash', 'gemini-3.5-flash-lite') then
    raise exception using errcode = 'P0001', message = 'AI_EDITORIAL_WINDOW_NOT_ALLOWED';
  end if;
  select * into v_run from news_clipping_private.daily_runs
  where run_date = date '2026-08-14' for update;
  if not found or v_run.status <> 'succeeded_without_publish'
     or v_run.journal ->> 'terminalReason' <> 'NO_ELIGIBLE_TOPIC'
     or coalesce((v_run.journal #>> '{run,usage,modelCalls}')::integer, -1) <> 0
     or exists (select 1 from news_clipping_private.posts where publication_date_kst = date '2026-08-14')
     or exists (select 1 from news_clipping_private.model_calls where run_id = v_run.run_id) then
    raise exception using errcode = 'P0001', message = 'AI_EDITORIAL_PRECONDITION_FAILED';
  end if;
  if p_post ->> 'publicationDateKst' <> '2026-08-14'
     or news_clipping_private.is_valid_published_post(p_post) is distinct from true
     or jsonb_array_length(p_post -> 'body') <> 3
     or exists (
       select 1 from jsonb_array_elements(p_post -> 'sources') source(value)
       where source.value ->> 'originalUrl' !~ '^https://'
     ) then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  if (select count(distinct value ->> 'publisherGroupId') from jsonb_array_elements(p_sources))
     <> jsonb_array_length(p_sources) then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_INDEPENDENT_SOURCES';
  end if;

  insert into news_clipping_private.topics(
    id, run_id, run_date, title, score, independence, evidence_policy,
    selection_reason, selected, created_at
  ) values (
    v_topic_id, v_run.run_id, date '2026-08-14', p_post ->> 'title',
    jsonb_build_object('aiSelected', true, 'windowStartKst', '2026-08-07',
      'windowEndKst', '2026-08-14T03:00:00+09:00', 'audit', p_ai_audit),
    jsonb_build_object('domesticPublisherGroups', jsonb_array_length(p_sources)),
    'two_independent_sources',
    '최근 7일 국내 기사 후보 전체에서 Gemini가 주제와 근거를 선택한 2026-08-14 부트스트랩 발행',
    true, v_now
  );

  for v_item in select value from jsonb_array_elements(p_sources) item(value) loop
    v_source_id := v_item ->> 'sourceId';
    v_article_id := v_item ->> 'articleId';
    if v_source_id is null or v_article_id is null or v_item ->> 'id' is null
       or v_item ->> 'url' !~ '^https://'
       or (v_item ->> 'publishedAt')::timestamptz < timestamptz '2026-08-07 00:00:00+09'
       or (v_item ->> 'publishedAt')::timestamptz >= timestamptz '2026-08-14 03:00:00+09'
       or char_length(btrim(v_item ->> 'passage')) not between 40 and 800 then
      raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
    end if;
    insert into news_clipping_private.sources(
      id, name, publisher_group_id, provenance_group_key, publisher_type,
      collection_type, canonical_base_url, terms_reviewed_at, enabled,
      registry_payload, created_at, updated_at
    ) values (
      v_source_id, v_item ->> 'publisher', v_item ->> 'publisherGroupId',
      v_item ->> 'provenanceGroupKey', 'news', 'api',
      substring(v_item ->> 'url' from '^https://[^/]+') || '/', v_now, true,
      jsonb_build_object('sourceId', v_source_id, 'sourceRole', 'independent',
        'sourceType', 'news', 'authority', 'none', 'editorialUse', true), v_now, v_now
    ) on conflict (id) do nothing;
    insert into news_clipping_private.articles(
      id, source_id, external_id, original_url, canonical_url,
      canonical_url_hash, title, normalized_title, excerpt, author, publisher,
      publisher_group_id, provenance_group_key, published_at,
      published_at_precision, discovered_at, content_fingerprint,
      canonicalization_version, fingerprint_version, origin_type, collected_at
    ) values (
      v_article_id, v_source_id, v_article_id, v_item ->> 'url', v_item ->> 'url',
      v_item ->> 'canonicalUrlHash', v_item ->> 'title', v_item ->> 'title',
      v_item ->> 'passage', null, v_item ->> 'publisher',
      v_item ->> 'publisherGroupId', v_item ->> 'provenanceGroupKey',
      (v_item ->> 'publishedAt')::timestamptz, 'instant', v_now,
      v_item ->> 'contentFingerprint', 'naver-api-ai-editorial-v1',
      'naver-api-ai-editorial-v1', 'original_reporting', v_now
    ) on conflict (canonical_url_hash) do nothing;
    select id, source_id into v_article_id, v_source_id
    from news_clipping_private.articles where canonical_url_hash = v_item ->> 'canonicalUrlHash';
    insert into news_clipping_private.evidence_items(
      id, article_id, source_id, passage_id, passage_hash, publisher_group_id,
      provenance_group_key, source_role, source_type, authority, source_name,
      title, url, published_at, published_at_precision, passage, locator, created_at
    ) values (
      v_item ->> 'id', v_article_id, v_source_id, (v_item ->> 'id') || '-passage',
      v_item ->> 'passageHash', v_item ->> 'publisherGroupId',
      v_item ->> 'provenanceGroupKey', 'independent', 'news', 'none',
      v_item ->> 'publisher', v_item ->> 'title', v_item ->> 'url',
      (v_item ->> 'publishedAt')::timestamptz, 'instant', v_item ->> 'passage',
      '네이버 뉴스 검색 API 요약', v_now
    );
    insert into news_clipping_private.topic_articles(topic_id, article_id)
      values (v_topic_id, v_article_id);
    insert into news_clipping_private.topic_evidence(topic_id, evidence_id, is_new_fact)
      values (v_topic_id, v_item ->> 'id', true);
  end loop;

  v_detail := p_post || jsonb_build_object('publishedAt', news_clipping_private.iso_json(v_now),
    'modifiedAt', news_clipping_private.iso_json(v_now));
  insert into news_clipping_private.posts(
    id, slug, publication_date_kst, topic_id, published_by_run_id, status,
    active_revision_id, published_at, modified_at, title, summary, visual
  ) values (p_post ->> 'id', p_post ->> 'slug', date '2026-08-14', v_topic_id,
    v_run.run_id, 'validated', null, null, v_now, p_post ->> 'title',
    p_post ->> 'summary', p_post -> 'visual');
  insert into news_clipping_private.post_revisions(id, post_id, detail, created_at)
    values (v_revision_id, p_post ->> 'id', v_detail, v_now);
  for v_item in select value from jsonb_array_elements(p_sources) item(value) loop
    select article_id, source_id into v_article_id, v_source_id
    from news_clipping_private.evidence_items where id = v_item ->> 'id';
    insert into news_clipping_private.post_sources(post_id, evidence_id, article_id, source_id, display_order)
      values (p_post ->> 'id', v_item ->> 'id', v_article_id, v_source_id, v_index);
    v_index := v_index + 1;
  end loop;
  update news_clipping_private.posts set status = 'published', active_revision_id = v_revision_id,
    published_at = v_now, modified_at = v_now where id = p_post ->> 'id';
  insert into public.published_posts(
    id, slug, status, publication_date_kst, published_at, modified_at,
    title, summary, visual, one_line_summary, body, questions, sources
  ) values (p_post ->> 'id', p_post ->> 'slug', 'published', date '2026-08-14', v_now, v_now,
    p_post ->> 'title', p_post ->> 'summary', p_post -> 'visual', p_post -> 'oneLineSummary',
    p_post -> 'body', p_post -> 'questions', p_post -> 'sources');
  return v_detail;
end;
$$;

revoke all on function public.publish_ai_selected_august14(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_ai_selected_august14(jsonb, jsonb, jsonb)
  to service_role;
commit;
