-- One-time editorial replacement for the current 2026-08-02..13 series.
-- The prior public rows must first be snapshotted by migration 017.
begin;

create or replace function public.get_august_editorial_targets()
returns table(
  publication_date_kst date,
  post_id text,
  slug text,
  published_at timestamptz,
  active_revision_id text
)
language sql
security definer
stable
set search_path = pg_catalog, news_clipping_private
as $$
  select p.publication_date_kst, p.id, p.slug, p.published_at, p.active_revision_id
  from news_clipping_private.posts p
  where p.publication_date_kst between date '2026-08-02' and date '2026-08-13'
    and p.status = 'published'
  order by p.publication_date_kst;
$$;

revoke all on function public.get_august_editorial_targets()
  from public, anon, authenticated;
grant execute on function public.get_august_editorial_targets()
  to service_role;

create or replace function public.apply_august_editorial_revision(
  p_run_date date,
  p_expected_post_id text,
  p_expected_active_revision_id text,
  p_new_revision_id text,
  p_post jsonb,
  p_sources jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_publication_time timestamptz;
  v_post news_clipping_private.posts%rowtype;
  v_run news_clipping_private.daily_runs%rowtype;
  v_topic_id text;
  v_detail jsonb;
  v_body_length integer;
  v_item jsonb;
  v_source_id text;
  v_article_id text;
  v_evidence_id text;
  v_index integer := 0;
begin
  if p_run_date < date '2026-08-02' or p_run_date > date '2026-08-13'
     or p_run_date = date '2026-08-01'
     or jsonb_typeof(p_sources) is distinct from 'array'
     or jsonb_array_length(p_sources) <> 2
     or p_new_revision_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));
  v_now := clock_timestamp();
  v_publication_time := (p_run_date::timestamp + time '07:00:00') at time zone 'Asia/Seoul';

  if not exists (
    select 1 from public.published_post_archive
    where archive_key = 'august-2026-original'
      and publication_date_kst = p_run_date
  ) and p_run_date not in (date '2026-08-09', date '2026-08-12') then
    raise exception using errcode = 'P0001', message = 'ARCHIVE_SNAPSHOT_REQUIRED';
  end if;

  select * into v_run
  from news_clipping_private.daily_runs
  where run_date = p_run_date
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RUN_NOT_FOUND';
  end if;

  select * into v_post
  from news_clipping_private.posts
  where publication_date_kst = p_run_date
  for update;

  if found then
    if p_expected_post_id is null
       or p_expected_active_revision_id is null
       or v_post.id <> p_expected_post_id
       or p_expected_active_revision_id is null
       or v_post.active_revision_id is distinct from p_expected_active_revision_id
       or v_post.status <> 'published'
       or p_post ->> 'id' is distinct from v_post.id
       or p_post ->> 'slug' is distinct from v_post.slug then
      raise exception using errcode = 'P0001', message = 'EDITORIAL_REVISION_CONFLICT';
    end if;
    v_topic_id := v_post.topic_id;
  else
    if p_run_date not in (date '2026-08-09', date '2026-08-12')
       or p_expected_post_id is not null
       or p_expected_active_revision_id is not null then
      raise exception using errcode = 'P0001', message = 'EDITORIAL_REVISION_CONFLICT';
    end if;
    v_topic_id := 'editorial-topic-' || replace(p_run_date::text, '-', '');
    insert into news_clipping_private.topics(
      id, run_id, run_date, title, score, independence, evidence_policy,
      selection_reason, selected, created_at
    ) values (
      v_topic_id, v_run.run_id, p_run_date, p_post ->> 'title',
      '{"editorial":true,"version":"thought-piece-v1"}'::jsonb,
      '{"editorial":true,"domesticSources":2}'::jsonb,
      'primary_plus_independent',
      '운영자가 승인한 2026년 8월 아카이브 보완 편집본', true, v_now
    );
  end if;

  if p_post ->> 'publicationDateKst' is distinct from p_run_date::text
     or coalesce(char_length(btrim(p_post ->> 'title')), 0) not between 1 and 36
     or coalesce(char_length(btrim(p_post ->> 'summary')), 0) not between 1 and 100
     or news_clipping_private.is_valid_published_post(p_post) is distinct from true
     or jsonb_array_length(p_post -> 'body') <> 3
     or exists (
       select 1 from jsonb_array_elements(p_post -> 'sources') source(value)
       where source.value ->> 'originalUrl' !~ '^https://(www\.)?(moe\.go\.kr|kedi\.re\.kr|keris\.or\.kr|m\.pipc\.go\.kr|hangyo\.com)/'
     ) then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  select coalesce(sum(char_length(claim ->> 'text')), 0) into v_body_length
  from jsonb_array_elements(p_post -> 'body') paragraph(value)
  cross join lateral jsonb_array_elements(paragraph.value -> 'claims') body_claim(claim);
  if v_body_length not between 600 and 1000 then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_LENGTH';
  end if;

  for v_item in select value from jsonb_array_elements(p_sources) item(value) loop
    v_source_id := v_item ->> 'sourceId';
    v_article_id := v_item ->> 'articleId';
    v_evidence_id := v_item ->> 'id';
    if v_source_id is null or v_article_id is null or v_evidence_id is null
       or v_item ->> 'url' !~ '^https://(www\.)?(moe\.go\.kr|kedi\.re\.kr|keris\.or\.kr|m\.pipc\.go\.kr|hangyo\.com)/'
       or char_length(btrim(v_item ->> 'passage')) not between 40 and 800 then
      raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
    end if;

    insert into news_clipping_private.sources(
      id, name, publisher_group_id, provenance_group_key, publisher_type,
      collection_type, canonical_base_url, terms_reviewed_at, enabled,
      registry_payload, created_at, updated_at
    ) values (
      v_source_id, v_item ->> 'publisher', v_item ->> 'publisherGroupId',
      v_item ->> 'provenanceGroupKey', v_item ->> 'publisherType', 'html',
      substring(v_item ->> 'url' from '^https://[^/]+') || '/', v_now, false,
      jsonb_build_object(
        'sourceId', v_source_id,
        'sourceRole', v_item ->> 'sourceRole',
        'sourceType', v_item ->> 'sourceType',
        'authority', 'none',
        'editorialUse', true
      ), v_now, v_now
    ) on conflict (id) do nothing;

    select a.id into v_article_id
    from news_clipping_private.articles a
    where a.canonical_url_hash = v_item ->> 'canonicalUrlHash'
      and a.source_id = v_source_id;
    if not found then
      v_article_id := v_item ->> 'articleId';
    end if;

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
      (v_item ->> 'publishedAt')::timestamptz, 'date', v_now,
      v_item ->> 'contentFingerprint', 'manual-editorial-v2',
      'manual-editorial-v2', v_item ->> 'originType', v_now
    ) on conflict (canonical_url_hash) do nothing;

    select a.id, a.source_id into v_article_id, v_source_id
    from news_clipping_private.articles a
    where a.canonical_url_hash = v_item ->> 'canonicalUrlHash';

    insert into news_clipping_private.evidence_items(
      id, article_id, source_id, passage_id, passage_hash, publisher_group_id,
      provenance_group_key, source_role, source_type, authority, source_name,
      title, url, published_at, published_at_precision, passage, locator, created_at
    ) values (
      v_evidence_id, v_article_id, v_source_id, v_evidence_id || '-passage',
      v_item ->> 'passageHash', v_item ->> 'publisherGroupId',
      v_item ->> 'provenanceGroupKey', v_item ->> 'sourceRole',
      v_item ->> 'sourceType', 'none', v_item ->> 'publisher',
      v_item ->> 'title', v_item ->> 'url',
      (v_item ->> 'publishedAt')::timestamptz, 'date', v_item ->> 'passage',
      '운영자 확인 국내 자료 요약', v_now
    ) on conflict (id) do nothing;

    if not exists (
      select 1 from news_clipping_private.evidence_items
      where id = v_evidence_id and article_id = v_article_id and source_id = v_source_id
        and title = v_item ->> 'title' and url = v_item ->> 'url'
        and passage = v_item ->> 'passage'
    ) then
      raise exception using errcode = 'P0001', message = 'EDITORIAL_SOURCE_CONFLICT';
    end if;

    insert into news_clipping_private.topic_articles(topic_id, article_id)
    values (v_topic_id, v_article_id) on conflict do nothing;
    insert into news_clipping_private.topic_evidence(topic_id, evidence_id, is_new_fact)
    values (v_topic_id, v_evidence_id, true) on conflict do nothing;
  end loop;

  if exists (select 1 from news_clipping_private.post_revisions where id = p_new_revision_id) then
    raise exception using errcode = 'P0001', message = 'EDITORIAL_REVISION_CONFLICT';
  end if;

  if v_post.id is null then
    insert into news_clipping_private.posts(
      id, slug, publication_date_kst, topic_id, published_by_run_id, status,
      active_revision_id, published_at, modified_at, title, summary, visual
    ) values (
      p_post ->> 'id', p_post ->> 'slug', p_run_date, v_topic_id, v_run.run_id,
      'validated', null, null, v_publication_time, p_post ->> 'title',
      p_post ->> 'summary', p_post -> 'visual'
    ) returning * into v_post;
  end if;

  v_detail := p_post || jsonb_build_object(
    'id', v_post.id,
    'slug', v_post.slug,
    'publicationDateKst', p_run_date::text,
    'publishedAt', news_clipping_private.iso_json(coalesce(v_post.published_at, v_publication_time)),
    'modifiedAt', news_clipping_private.iso_json(v_now)
  );
  insert into news_clipping_private.post_revisions(id, post_id, detail, created_at)
  values (p_new_revision_id, v_post.id, v_detail, v_now);

  update news_clipping_private.post_sources
  set display_order = display_order + 100
  where post_id = v_post.id;
  v_index := 0;
  for v_item in select value from jsonb_array_elements(p_sources) item(value) loop
    insert into news_clipping_private.post_sources(
      post_id, evidence_id, article_id, source_id, display_order
    ) values (
      v_post.id, v_item ->> 'id', (
        select e.article_id from news_clipping_private.evidence_items e
        where e.id = v_item ->> 'id'
      ),
      (
        select e.source_id from news_clipping_private.evidence_items e
        where e.id = v_item ->> 'id'
      ), v_index
    ) on conflict (post_id, evidence_id) do update set display_order = excluded.display_order;
    v_index := v_index + 1;
  end loop;

  update news_clipping_private.posts set
    status = 'published', active_revision_id = p_new_revision_id,
    published_at = coalesce(published_at, v_publication_time), modified_at = v_now,
    title = v_detail ->> 'title', summary = v_detail ->> 'summary', visual = v_detail -> 'visual'
  where id = v_post.id;

  insert into public.published_posts(
    id, slug, status, publication_date_kst, published_at, modified_at,
    title, summary, visual, one_line_summary, body, questions, sources
  ) values (
    v_post.id, v_post.slug, 'published', p_run_date,
    coalesce(v_post.published_at, v_publication_time), v_now,
    v_detail ->> 'title', v_detail ->> 'summary', v_detail -> 'visual',
    v_detail -> 'oneLineSummary', v_detail -> 'body', v_detail -> 'questions', v_detail -> 'sources'
  ) on conflict (id) do update set
    modified_at = excluded.modified_at, title = excluded.title, summary = excluded.summary,
    visual = excluded.visual, one_line_summary = excluded.one_line_summary,
    body = excluded.body, questions = excluded.questions, sources = excluded.sources;

  return v_detail;
end;
$$;

revoke all on function public.apply_august_editorial_revision(date, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_august_editorial_revision(date, text, text, text, jsonb, jsonb)
  to service_role;

comment on function public.apply_august_editorial_revision(date, text, text, text, jsonb, jsonb) is
  'One-time operator-approved August 2-13 domestic-source editorial replacement after archive snapshot 017.';

commit;
