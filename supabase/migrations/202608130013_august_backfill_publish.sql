-- Operator-approved, one-time publication boundary for the 2026-08-01..12
-- archive. This keeps the normal current-day publish_post contract unchanged.
begin;

create or replace function public.publish_backfill_post(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_validation_output_reference text,
  p_revision_id text,
  p_topic_id text,
  p_post jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_publication_time timestamptz;
  v_run news_clipping_private.daily_runs%rowtype;
  v_post_id text := p_post ->> 'id';
  v_slug text := p_post ->> 'slug';
  v_detail jsonb;
  v_source jsonb;
  v_source_id text;
  v_source_count integer;
  v_distinct_source_count integer;
  v_evidence news_clipping_private.evidence_items%rowtype;
  v_existing news_clipping_private.posts%rowtype;
  v_validate_step jsonb;
  v_validation_artifact news_clipping_private.pipeline_artifacts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));
  select * into v_run from news_clipping_private.daily_runs where run_date = p_run_date for update;
  v_now := clock_timestamp();
  if not found then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_run.lease_token <> p_lease_token then raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH'; end if;
  if v_run.fence <> p_fence then raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH'; end if;
  if v_run.run_id <> p_run_id then raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH'; end if;
  if v_run.journal_revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION'; end if;
  if v_run.lease_expires_at is null or v_run.lease_expires_at <= v_now then
    raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED';
  end if;
  if v_run.status <> 'running' or v_run.journal #>> '{run,currentStage}' <> 'publish' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;
  if jsonb_typeof(v_run.journal #> '{run,steps}') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  select value into v_validate_step
  from jsonb_array_elements(v_run.journal #> '{run,steps}') as step(value)
  where value ->> 'stage' = 'validate';
  if not found
     or v_validate_step ->> 'status' <> 'succeeded'
     or v_validate_step ->> 'outputReference' is distinct from p_validation_output_reference then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  select * into v_validation_artifact
  from news_clipping_private.pipeline_artifacts
  where output_reference = p_validation_output_reference;
  if not found
     or v_validation_artifact.run_id <> p_run_id
     or v_validation_artifact.stage <> 'validate'
     or v_validation_artifact.kind <> 'publication'
     or v_validation_artifact.payload ->> 'kind' <> 'publication'
     or v_validation_artifact.payload #> '{value,qualityResult,passed}' is distinct from 'true'::jsonb
     or not (
       (v_validation_artifact.payload #>> '{value,generationOutputReference}') =
       any(v_validation_artifact.parent_output_references)
     )
     or v_validation_artifact.payload #> '{value,post}' is distinct from p_post then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  if p_run_date < date '2026-08-01' or p_run_date > date '2026-08-12'
     or p_run_date >= (v_now at time zone 'Asia/Seoul')::date then
    raise exception using errcode = 'P0001', message = 'BACKFILL_DATE_NOT_ALLOWED';
  end if;
  v_publication_time := (p_run_date::timestamp + time '07:00:00') at time zone 'Asia/Seoul';
  if not coalesce(v_post_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false)
     or not coalesce(p_revision_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false)
     or not coalesce(v_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$', false)
     or coalesce(char_length(v_slug), 121) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  if not exists (
    select 1 from news_clipping_private.topics
    where id = p_topic_id and run_id = p_run_id and run_date = p_run_date and selected
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;

  select * into v_existing from news_clipping_private.posts where published_by_run_id = p_run_id;
  if found then
    if v_existing.id = v_post_id and v_existing.slug = v_slug and v_existing.publication_date_kst = p_run_date
       and v_existing.active_revision_id = p_revision_id and v_existing.status = 'published' then
      select detail into v_detail from news_clipping_private.post_revisions
        where id = p_revision_id and post_id = v_post_id;
      return v_detail;
    end if;
    raise exception using errcode = 'P0001', message = 'DUPLICATE_PUBLICATION_DATE';
  end if;
  if exists (select 1 from news_clipping_private.posts where publication_date_kst = p_run_date) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_PUBLICATION_DATE';
  end if;
  if exists (select 1 from news_clipping_private.posts where slug = v_slug) then
    raise exception using errcode = 'P0001', message = 'SLUG_CONFLICT';
  end if;

  if news_clipping_private.is_valid_published_post(p_post) is distinct from true then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;

  select count(*), count(distinct value ->> 'id')
    into v_source_count, v_distinct_source_count
    from jsonb_array_elements(p_post -> 'sources') as source(value);
  if v_source_count <> v_distinct_source_count then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;

  v_detail := p_post || jsonb_build_object(
    'id', v_post_id,
    'slug', v_slug,
    'publicationDateKst', p_run_date::text,
    'publishedAt', news_clipping_private.iso_json(v_publication_time),
    'modifiedAt', news_clipping_private.iso_json(v_publication_time)
  );

  for v_source_id in
    select jsonb_array_elements_text(v_detail #> '{oneLineSummary,sourceIds}')
    union
    select jsonb_array_elements_text(claim -> 'sourceIds')
    from jsonb_array_elements(v_detail -> 'body') as paragraph(value)
    cross join lateral jsonb_array_elements(paragraph.value -> 'claims') as body_claim(claim)
  loop
    if not exists (
      select 1 from jsonb_array_elements(v_detail -> 'sources') as source(value)
      where source.value ->> 'id' = v_source_id
    ) then
      raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
    end if;
  end loop;

  insert into news_clipping_private.posts(
    id, slug, publication_date_kst, topic_id, published_by_run_id, status,
    active_revision_id, published_at, modified_at, title, summary, visual
  ) values (
    v_post_id, v_slug, p_run_date, p_topic_id, p_run_id, 'validated',
    null, null, v_publication_time, p_post ->> 'title', p_post ->> 'summary', p_post -> 'visual'
  );
  insert into news_clipping_private.post_revisions(id, post_id, detail, created_at)
    values (p_revision_id, v_post_id, v_detail, v_now);

  for v_source in
    select value || jsonb_build_object('_order', ordinality - 1)
    from jsonb_array_elements(v_detail -> 'sources') with ordinality as source(value, ordinality)
  loop
    v_source_id := v_source ->> 'id';
    select * into v_evidence from news_clipping_private.evidence_items where id = v_source_id;
    if not found
       or not exists (
         select 1 from news_clipping_private.topic_evidence
         where topic_id = p_topic_id and evidence_id = v_source_id
       )
       or v_source ->> 'title' <> v_evidence.title
       or v_source ->> 'publisher' <> v_evidence.source_name
       or v_source ->> 'originalUrl' <> v_evidence.url
       or (v_source ->> 'publishedDate') is distinct from (v_evidence.published_at at time zone 'Asia/Seoul')::date::text then
      raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
    end if;
    insert into news_clipping_private.post_sources(post_id, evidence_id, article_id, source_id, display_order)
      values (v_post_id, v_evidence.id, v_evidence.article_id, v_evidence.source_id, (v_source ->> '_order')::smallint);
  end loop;

  update news_clipping_private.posts set
    status = 'published', active_revision_id = p_revision_id,
    published_at = v_publication_time, modified_at = v_publication_time
  where id = v_post_id;

  insert into public.published_posts(
    id, slug, status, publication_date_kst, published_at, modified_at,
    title, summary, visual, one_line_summary, body, questions, sources
  ) values (
    v_post_id, v_slug, 'published', p_run_date, v_publication_time, v_publication_time,
    v_detail ->> 'title', v_detail ->> 'summary', v_detail -> 'visual',
    v_detail -> 'oneLineSummary', v_detail -> 'body', v_detail -> 'questions', v_detail -> 'sources'
  );
  return v_detail;
end;
$$;

revoke all on function public.publish_backfill_post(date, text, text, bigint, integer, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_backfill_post(date, text, text, bigint, integer, text, text, text, jsonb)
  to service_role;

comment on function public.publish_backfill_post(date, text, text, bigint, integer, text, text, text, jsonb) is
  'Operator-approved publication for 2026-08-01 through 2026-08-12 only; preserves the full validated publication lineage.';

commit;
