-- M19-FULLTEXT-BACKEND
-- Private, permission-gated article body storage. No policy is registered here:
-- each publisher must be enabled by a later reviewed forward migration.

begin;

create table news_clipping_private.source_full_text_policies (
  source_id text primary key references news_clipping_private.sources(id) on delete restrict,
  full_text_use_allowed boolean not null check (full_text_use_allowed is true),
  allowed_origins jsonb not null check (
    jsonb_typeof(allowed_origins) = 'array'
    and jsonb_array_length(allowed_origins) between 1 and 5
    and not jsonb_path_exists(
      allowed_origins,
      '$[*] ? (@.type() != "string" || !(@ like_regex "^https://[^/?#]+$") flag "i")'
    )
  ),
  access_reviewed_at timestamptz not null,
  policy_reference_urls jsonb not null check (
    jsonb_typeof(policy_reference_urls) = 'array'
    and jsonb_array_length(policy_reference_urls) between 1 and 5
    and not jsonb_path_exists(
      policy_reference_urls,
      '$[*] ? (@.type() != "string" || !(@ like_regex "^https://") flag "i")'
    )
  ),
  retention_days integer not null check (retention_days between 1 and 90),
  max_response_bytes integer not null check (max_response_bytes between 16384 and 500000),
  max_text_characters integer not null check (max_text_characters between 1000 and 100000),
  reviewed_notes text not null check (char_length(btrim(reviewed_notes)) between 1 and 1000),
  created_at timestamptz not null default statement_timestamp()
);

create table news_clipping_private.article_full_texts (
  article_id text primary key references news_clipping_private.articles(id) on delete restrict,
  source_id text not null references news_clipping_private.sources(id) on delete restrict,
  canonical_url text not null,
  final_url text not null,
  body_text text not null check (char_length(body_text) between 1000 and 100000),
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  response_bytes integer not null check (response_bytes between 1 and 500000),
  collected_at timestamptz not null,
  retention_until timestamptz not null check (retention_until > collected_at),
  permission_snapshot jsonb not null check (
    jsonb_typeof(permission_snapshot) = 'object'
    and permission_snapshot -> 'fullTextUseAllowed' = 'true'::jsonb
  ),
  collect_run_id text not null references news_clipping_private.daily_runs(run_id) on delete restrict,
  collect_output_reference text not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (source_id, canonical_url),
  constraint article_full_text_retention_limit check (
    retention_until <= collected_at + interval '90 days'
  )
);

create index article_full_texts_retention
  on news_clipping_private.article_full_texts(retention_until);

create trigger article_full_texts_are_immutable
before update on news_clipping_private.article_full_texts
for each row execute function news_clipping_private.reject_immutable_row_mutation();

alter table news_clipping_private.source_full_text_policies enable row level security;
alter table news_clipping_private.source_full_text_policies force row level security;
alter table news_clipping_private.article_full_texts enable row level security;
alter table news_clipping_private.article_full_texts force row level security;

revoke all on news_clipping_private.source_full_text_policies
  from public, anon, authenticated, service_role;
revoke all on news_clipping_private.article_full_texts
  from public, anon, authenticated, service_role;

create function public.persist_article_full_texts(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_collect_output_reference text,
  p_full_texts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_run news_clipping_private.daily_runs%rowtype;
  v_collect news_clipping_private.pipeline_artifacts%rowtype;
  v_item jsonb;
  v_article news_clipping_private.articles%rowtype;
  v_policy news_clipping_private.source_full_text_policies%rowtype;
  v_existing news_clipping_private.article_full_texts%rowtype;
  v_ids text[] := '{}'::text[];
  v_created integer := 0;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-daily:' || p_run_date::text, 0)
  );
  select * into v_run
  from news_clipping_private.daily_runs
  where run_date = p_run_date
  for update;
  v_now := clock_timestamp();
  if not found or v_run.lease_token is null then
    raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND';
  end if;
  if v_run.run_id <> p_run_id then
    raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH';
  end if;
  if v_run.lease_token <> p_lease_token then
    raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH';
  end if;
  if v_run.fence <> p_fence then
    raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH';
  end if;
  if v_run.journal_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION';
  end if;
  if v_run.lease_expires_at is null or v_run.lease_expires_at <= v_now then
    raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED';
  end if;

  select * into v_collect
  from news_clipping_private.pipeline_artifacts
  where run_id = p_run_id and stage = 'collect';
  if not found
     or v_collect.kind is distinct from 'news_ingestion'
     or v_collect.output_reference is distinct from p_collect_output_reference then
    raise exception using errcode = 'P0001', message = 'COLLECT_ARTIFACT_REQUIRED';
  end if;
  if jsonb_typeof(p_full_texts) is distinct from 'array'
     or jsonb_array_length(p_full_texts) > 20
     or jsonb_array_length(p_full_texts) < 1
     or (select count(*) <> count(distinct value ->> 'articleId')
         from jsonb_array_elements(p_full_texts)) then
    raise exception using errcode = 'P0001', message = 'INVALID_FULL_TEXT_PAYLOAD';
  end if;

  for v_item in select value from jsonb_array_elements(p_full_texts) item(value) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce((v_item ->> 'articleId') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
       or coalesce((v_item ->> 'sourceId') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
       or not coalesce((v_item ->> 'canonicalUrl') ~ '^https://', false)
       or not coalesce((v_item ->> 'finalUrl') ~ '^https://', false)
       or char_length(v_item ->> 'bodyText') not between 1000 and 100000
       or not coalesce((v_item ->> 'bodySha256') ~ '^[a-f0-9]{64}$', false)
       or coalesce((v_item ->> 'responseBytes')::integer, 0) not between 1 and 500000
       or v_item #> '{permission,fullTextUseAllowed}' is distinct from 'true'::jsonb then
      raise exception using errcode = 'P0001', message = 'INVALID_FULL_TEXT_PAYLOAD';
    end if;

    select * into v_article
    from news_clipping_private.articles
    where id = v_item ->> 'articleId';
    select * into v_policy
    from news_clipping_private.source_full_text_policies
    where source_id = v_item ->> 'sourceId'
      and full_text_use_allowed is true;
    if v_article.id is null
       or v_policy.source_id is null
       or v_article.source_id is distinct from v_item ->> 'sourceId'
       or v_article.canonical_url is distinct from v_item ->> 'canonicalUrl'
       or not coalesce(
         v_policy.allowed_origins ? (regexp_match(v_item ->> 'finalUrl', '^(https://[^/]+)'))[1],
         false
       )
       or (v_item #>> '{permission,accessReviewedAt}')::timestamptz is distinct from v_policy.access_reviewed_at
       or v_item #> '{permission,policyReferenceUrls}' is distinct from v_policy.policy_reference_urls
       or extensions.digest(v_item ->> 'bodyText', 'sha256') is distinct from
          decode(v_item ->> 'bodySha256', 'hex')
       or (v_item ->> 'responseBytes')::integer > v_policy.max_response_bytes
       or char_length(v_item ->> 'bodyText') > v_policy.max_text_characters
       or (v_item ->> 'collectedAt')::timestamptz > v_now + interval '5 minutes'
       or (v_item ->> 'retentionUntil')::timestamptz >
          v_now + make_interval(days => v_policy.retention_days)
       or not exists (
         select 1
         from jsonb_array_elements(v_collect.payload #> '{value,articles}') article(value)
         where article.value ->> 'articleId' = v_item ->> 'articleId'
       ) then
      raise exception using errcode = 'P0001', message = 'FULL_TEXT_PERMISSION_REQUIRED';
    end if;

    select * into v_existing
    from news_clipping_private.article_full_texts
    where article_id = v_item ->> 'articleId'
    for update;
    if found then
      if v_existing.source_id is distinct from v_item ->> 'sourceId'
         or v_existing.canonical_url is distinct from v_item ->> 'canonicalUrl'
         or v_existing.final_url is distinct from v_item ->> 'finalUrl'
         or v_existing.body_text is distinct from v_item ->> 'bodyText'
         or v_existing.body_sha256 is distinct from v_item ->> 'bodySha256'
         or v_existing.response_bytes is distinct from (v_item ->> 'responseBytes')::integer
         or v_existing.collected_at is distinct from (v_item ->> 'collectedAt')::timestamptz
         or v_existing.retention_until is distinct from (v_item ->> 'retentionUntil')::timestamptz
         or v_existing.permission_snapshot is distinct from v_item -> 'permission'
         or v_existing.collect_run_id is distinct from p_run_id
         or v_existing.collect_output_reference is distinct from p_collect_output_reference then
        raise exception using errcode = 'P0001', message = 'FULL_TEXT_IDENTITY_CONFLICT';
      end if;
    else
      insert into news_clipping_private.article_full_texts(
        article_id, source_id, canonical_url, final_url, body_text, body_sha256,
        response_bytes, collected_at, retention_until, permission_snapshot,
        collect_run_id, collect_output_reference
      ) values (
        v_item ->> 'articleId', v_item ->> 'sourceId',
        v_item ->> 'canonicalUrl', v_item ->> 'finalUrl',
        v_item ->> 'bodyText', v_item ->> 'bodySha256',
        (v_item ->> 'responseBytes')::integer,
        (v_item ->> 'collectedAt')::timestamptz,
        (v_item ->> 'retentionUntil')::timestamptz,
        v_item -> 'permission', p_run_id, p_collect_output_reference
      );
      v_created := v_created + 1;
    end if;
    v_ids := array_append(v_ids, v_item ->> 'articleId');
  end loop;
  return jsonb_build_object('createdCount', v_created, 'articleIds', to_jsonb(v_ids));
exception
  when invalid_text_representation or datetime_field_overflow
    or numeric_value_out_of_range or check_violation or not_null_violation
    or foreign_key_violation or unique_violation then
    raise exception using errcode = 'P0001', message = 'INVALID_FULL_TEXT_PAYLOAD';
end;
$$;

create function public.get_selected_article_full_texts(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_score_output_reference text,
  p_evidence_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_run news_clipping_private.daily_runs%rowtype;
  v_score news_clipping_private.pipeline_artifacts%rowtype;
  v_requested_ids text[];
  v_stored_ids text[];
  v_rows jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-daily:' || p_run_date::text, 0)
  );
  select * into v_run
  from news_clipping_private.daily_runs
  where run_date = p_run_date
  for update;
  v_now := clock_timestamp();
  if not found or v_run.lease_token is null then
    raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND';
  end if;
  if v_run.run_id <> p_run_id then raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH'; end if;
  if v_run.lease_token <> p_lease_token then raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH'; end if;
  if v_run.fence <> p_fence then raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH'; end if;
  if v_run.journal_revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION'; end if;
  if v_run.lease_expires_at is null or v_run.lease_expires_at <= v_now then raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED'; end if;
  if v_run.status <> 'running'
     or v_run.journal #>> '{run,currentStage}' is distinct from 'generate' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;
  if jsonb_typeof(p_evidence_ids) is distinct from 'array'
     or jsonb_array_length(p_evidence_ids) not between 1 and 20 then
    raise exception using errcode = 'P0001', message = 'INVALID_FULL_TEXT_PAYLOAD';
  end if;
  select array_agg(value order by value) into v_requested_ids
  from jsonb_array_elements_text(p_evidence_ids) item(value);
  if cardinality(v_requested_ids) is distinct from
       (select count(distinct value) from unnest(v_requested_ids) item(value)) then
    raise exception using errcode = 'P0001', message = 'INVALID_FULL_TEXT_PAYLOAD';
  end if;
  select * into v_score
  from news_clipping_private.pipeline_artifacts
  where run_id = p_run_id and stage = 'score'
  for update;
  if not found
     or v_score.kind is distinct from 'topic_selection'
     or v_score.output_reference is distinct from p_score_output_reference
     or v_score.payload #>> '{value,outcome}' is distinct from 'eligible' then
    raise exception using errcode = 'P0001', message = 'SELECTED_TOPIC_REQUIRED';
  end if;
  select array_agg(value ->> 'evidenceId' order by value ->> 'evidenceId')
  into v_stored_ids
  from jsonb_array_elements(v_score.payload #> '{value,evidenceItems}') item(value);
  if v_stored_ids is distinct from v_requested_ids then
    raise exception using errcode = 'P0001', message = 'SELECTED_TOPIC_REQUIRED';
  end if;
  select jsonb_agg(jsonb_build_object(
    'articleId', body.article_id,
    'sourceId', body.source_id,
    'canonicalUrl', body.canonical_url,
    'bodyText', body.body_text,
    'bodySha256', body.body_sha256,
    'collectedAt', body.collected_at,
    'retentionUntil', body.retention_until,
    'finalUrl', body.final_url,
    'responseBytes', body.response_bytes,
    'permission', body.permission_snapshot
  ) order by body.article_id)
  into v_rows
  from unnest(v_requested_ids) requested(evidence_id)
  join news_clipping_private.evidence_items evidence
    on evidence.id = requested.evidence_id
  join news_clipping_private.article_full_texts body
    on body.article_id = evidence.article_id
   and body.source_id = evidence.source_id
  where body.retention_until > v_now;
  if jsonb_array_length(coalesce(v_rows, '[]'::jsonb)) <>
       cardinality(v_requested_ids) then
    raise exception using errcode = 'P0001', message = 'FULL_TEXT_COVERAGE_REQUIRED';
  end if;
  return v_rows;
end;
$$;

create function public.purge_expired_article_full_texts(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_deleted_ids text[];
begin
  if p_limit not between 1 and 1000 then
    raise exception using errcode = 'P0001', message = 'INVALID_PURGE_LIMIT';
  end if;
  with expired as (
    select article_id
    from news_clipping_private.article_full_texts
    where retention_until <= statement_timestamp()
    order by retention_until, article_id
    for update skip locked
    limit p_limit
  ), deleted as (
    delete from news_clipping_private.article_full_texts body
    using expired
    where body.article_id = expired.article_id
    returning body.article_id
  )
  select coalesce(array_agg(article_id order by article_id), '{}'::text[])
  into v_deleted_ids
  from deleted;
  return jsonb_build_object(
    'deletedCount', cardinality(v_deleted_ids),
    'articleIds', to_jsonb(v_deleted_ids)
  );
end;
$$;

revoke all on function public.persist_article_full_texts(
  date, text, text, bigint, integer, text, jsonb
) from public, anon, authenticated;
revoke all on function public.get_selected_article_full_texts(
  date, text, text, bigint, integer, text, jsonb
)
  from public, anon, authenticated;
revoke all on function public.purge_expired_article_full_texts(integer)
  from public, anon, authenticated;
grant execute on function public.persist_article_full_texts(
  date, text, text, bigint, integer, text, jsonb
) to service_role;
grant execute on function public.get_selected_article_full_texts(
  date, text, text, bigint, integer, text, jsonb
) to service_role;
grant execute on function public.purge_expired_article_full_texts(integer)
  to service_role;

comment on table news_clipping_private.article_full_texts is
  'Private extracted article bodies with permission evidence and bounded retention; never exposed through Data API.';
comment on function public.persist_article_full_texts is
  'Server-only fenced, idempotent full-text persistence bound to an exact collect artifact.';
comment on function public.get_selected_article_full_texts is
  'Server-only fenced retrieval of exact selected-topic article bodies for grounded generation.';
comment on function public.purge_expired_article_full_texts is
  'Server-only bounded deletion of full-text rows after their retention deadline.';

commit;
