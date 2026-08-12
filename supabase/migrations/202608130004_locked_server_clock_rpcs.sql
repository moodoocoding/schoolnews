-- M7-SUPABASE-LOCKED-CLOCK-001
-- Evaluate authoritative server time only after daily serialization locks.
-- Forward-only replacement: signatures, JSON contracts, grants and behavior
-- remain identical to migration 001.

begin;

create or replace function public.acquire_daily_run(
  p_run_date date,
  p_requested_lease jsonb,
  p_initial_journal jsonb,
  p_requested_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_duration interval;
  v_row news_clipping_private.daily_runs%rowtype;
  v_journal jsonb;
  v_terminal boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));

  select * into v_row from news_clipping_private.daily_runs
  where run_date = p_run_date for update;
  v_now := clock_timestamp();

  if p_requested_lease ->> 'runDate' <> p_run_date::text
     or p_initial_journal #>> '{run,runDate}' <> p_run_date::text
     or p_requested_lease ->> 'runId' <> p_initial_journal #>> '{run,runId}' then
    raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH';
  end if;
  if (p_requested_lease ->> 'ownerId') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or (p_requested_lease ->> 'leaseToken') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;

  v_duration := (p_requested_lease ->> 'expiresAt')::timestamptz
                - (p_requested_lease ->> 'acquiredAt')::timestamptz;
  if v_duration <= interval '0 seconds' or v_duration > interval '24 hours' then
    raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED';
  end if;

  if not found then
    if (p_initial_journal ->> 'revision')::integer <> 0
       or p_initial_journal #>> '{run,status}' <> 'running'
       or p_initial_journal -> 'finishedAt' <> 'null'::jsonb
       or p_initial_journal -> 'terminalReason' <> 'null'::jsonb
       or jsonb_array_length(p_initial_journal -> 'attempts') <> 0 then
      raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
    end if;
    v_journal := jsonb_set(
      jsonb_set(p_initial_journal, '{startedAt}', news_clipping_private.iso_json(v_now), false),
      '{updatedAt}', news_clipping_private.iso_json(v_now), false
    );
    insert into news_clipping_private.daily_runs(
      run_date, run_id, journal, journal_revision, status,
      owner_id, lease_token, fence, lease_acquired_at, lease_expires_at,
      last_client_observed_at, created_at, updated_at
    ) values (
      p_run_date, p_requested_lease ->> 'runId', v_journal, 0, 'running',
      p_requested_lease ->> 'ownerId', p_requested_lease ->> 'leaseToken', 1,
      v_now, v_now + v_duration, p_requested_now, v_now, v_now
    ) returning * into v_row;
    return jsonb_build_object(
      'status', 'acquired', 'lease', news_clipping_private.lease_json(v_row),
      'journal', v_row.journal, 'recoveredExpiredLease', false
    );
  end if;

  v_terminal := v_row.status in ('succeeded','succeeded_without_publish','published_with_warning','failed','blocked');
  if v_terminal then
    return jsonb_build_object('status', 'terminal', 'journal', v_row.journal);
  end if;
  if v_row.lease_expires_at > v_now then
    return jsonb_build_object(
      'status', 'busy', 'runDate', v_row.run_date::text, 'runId', v_row.run_id,
      'ownerId', v_row.owner_id, 'expiresAt', news_clipping_private.iso_json(v_row.lease_expires_at)
    );
  end if;
  if v_row.lease_token is null then
    raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND';
  end if;

  update news_clipping_private.daily_runs set
    owner_id = p_requested_lease ->> 'ownerId',
    lease_token = p_requested_lease ->> 'leaseToken',
    fence = fence + 1,
    lease_acquired_at = v_now,
    lease_expires_at = v_now + v_duration,
    last_client_observed_at = p_requested_now,
    updated_at = v_now
  where run_date = p_run_date returning * into v_row;

  return jsonb_build_object(
    'status', 'acquired', 'lease', news_clipping_private.lease_json(v_row),
    'journal', v_row.journal, 'recoveredExpiredLease', true
  );
end;
$$;

create or replace function public.checkpoint_daily_run(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_journal jsonb,
  p_requested_renewed_at timestamptz,
  p_requested_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_duration interval := p_requested_expires_at - p_requested_renewed_at;
  v_row news_clipping_private.daily_runs%rowtype;
  v_next jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));
  select * into v_row from news_clipping_private.daily_runs
    where run_date = p_run_date for update;
  v_now := clock_timestamp();
  if not found then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_row.lease_token is null then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_row.lease_token <> p_lease_token then raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH'; end if;
  if v_row.fence <> p_fence then raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH'; end if;
  if v_row.run_id <> p_run_id or p_journal #>> '{run,runId}' <> p_run_id
     or p_journal #>> '{run,runDate}' <> p_run_date::text then
    raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH';
  end if;
  if v_row.journal_revision <> p_expected_revision
     or (p_journal ->> 'revision')::integer <> p_expected_revision + 1 then
    raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION';
  end if;
  if v_row.lease_expires_at <= v_now then raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED'; end if;
  if v_duration <= interval '0 seconds' or v_duration > interval '24 hours' then
    raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED';
  end if;
  if p_journal #>> '{run,status}' <> 'running'
     or p_journal -> 'finishedAt' <> 'null'::jsonb
     or p_journal -> 'terminalReason' <> 'null'::jsonb then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;

  perform news_clipping_private.assert_journal_transition(v_row.journal, p_journal);
  v_next := jsonb_set(p_journal, '{updatedAt}', news_clipping_private.iso_json(v_now), false);
  update news_clipping_private.daily_runs set
    journal = v_next,
    journal_revision = p_expected_revision + 1,
    status = v_next #>> '{run,status}',
    lease_acquired_at = v_now,
    lease_expires_at = v_now + v_duration,
    last_client_observed_at = p_requested_renewed_at,
    updated_at = v_now
  where run_date = p_run_date returning * into v_row;
  return jsonb_build_object('journal', v_row.journal, 'lease', news_clipping_private.lease_json(v_row));
end;
$$;

create or replace function public.finish_daily_run(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_journal jsonb,
  p_requested_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_row news_clipping_private.daily_runs%rowtype;
  v_next jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));
  select * into v_row from news_clipping_private.daily_runs
    where run_date = p_run_date for update;
  v_now := clock_timestamp();
  if not found then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_row.lease_token is null then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_row.lease_token <> p_lease_token then raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH'; end if;
  if v_row.fence <> p_fence then raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH'; end if;
  if v_row.lease_expires_at <= v_now then raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED'; end if;
  if v_row.run_id <> p_run_id or p_journal #>> '{run,runId}' <> p_run_id
     or p_journal #>> '{run,runDate}' <> p_run_date::text then
    raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH';
  end if;
  if v_row.journal_revision <> p_expected_revision
     or (p_journal ->> 'revision')::integer <> p_expected_revision + 1 then
    raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION';
  end if;
  if p_journal #>> '{run,status}' not in ('succeeded','succeeded_without_publish','published_with_warning','failed','blocked')
     or p_journal #>> '{run,currentStage}' is not null
     or p_journal -> 'finishedAt' = 'null'::jsonb then
    raise exception using errcode = 'P0001', message = 'TERMINAL_JOURNAL_REQUIRED';
  end if;

  perform news_clipping_private.assert_journal_transition(v_row.journal, p_journal);
  v_next := jsonb_set(
    jsonb_set(p_journal, '{updatedAt}', news_clipping_private.iso_json(v_now), false),
    '{finishedAt}', news_clipping_private.iso_json(v_now), false
  );
  update news_clipping_private.daily_runs set
    journal = v_next,
    journal_revision = p_expected_revision + 1,
    status = v_next #>> '{run,status}',
    owner_id = null, lease_token = null,
    lease_acquired_at = null, lease_expires_at = null,
    last_client_observed_at = p_requested_now,
    updated_at = v_now, finished_at = v_now
  where run_date = p_run_date returning * into v_row;
  return v_row.journal;
end;
$$;

create or replace function public.publish_post(
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
  if (v_now at time zone 'Asia/Seoul')::date <> p_run_date then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_PUBLICATION_DATE';
  end if;
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
    'publishedAt', news_clipping_private.iso_json(v_now),
    'modifiedAt', news_clipping_private.iso_json(v_now)
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
    null, null, v_now, p_post ->> 'title', p_post ->> 'summary', p_post -> 'visual'
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
    published_at = v_now, modified_at = v_now
  where id = v_post_id;

  insert into public.published_posts(
    id, slug, status, publication_date_kst, published_at, modified_at,
    title, summary, visual, one_line_summary, body, questions, sources
  ) values (
    v_post_id, v_slug, 'published', p_run_date, v_now, v_now,
    v_detail ->> 'title', v_detail ->> 'summary', v_detail -> 'visual',
    v_detail -> 'oneLineSummary', v_detail -> 'body', v_detail -> 'questions', v_detail -> 'sources'
  );
  return v_detail;
end;
$$;

revoke all on function public.acquire_daily_run(date, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.checkpoint_daily_run(date, text, text, bigint, integer, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_daily_run(date, text, text, bigint, integer, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.publish_post(date, text, text, bigint, integer, text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.acquire_daily_run(date, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.checkpoint_daily_run(date, text, text, bigint, integer, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.finish_daily_run(date, text, text, bigint, integer, jsonb, timestamptz) to service_role;
grant execute on function public.publish_post(date, text, text, bigint, integer, text, text, text, jsonb) to service_role;

commit;
