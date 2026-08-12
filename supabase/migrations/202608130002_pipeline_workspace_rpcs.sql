-- Server-only persistence boundary for immutable pipeline workspace artifacts.
-- This migration is forward-only and intentionally keeps the private schema
-- outside the exposed Data API schemas.

begin;

create function news_clipping_private.pipeline_artifact_json(
  p_row news_clipping_private.pipeline_artifacts
)
returns jsonb
language sql
stable
strict
set search_path = pg_catalog, news_clipping_private
as $$
  select jsonb_build_object(
    'runId', p_row.run_id,
    'stage', p_row.stage,
    'kind', p_row.kind,
    'outputReference', p_row.output_reference,
    'payloadFingerprint', p_row.payload_fingerprint,
    'configurationFingerprint', p_row.configuration_fingerprint,
    'parentOutputReferences', to_jsonb(p_row.parent_output_references),
    'payload', p_row.payload
  );
$$;

create function public.put_pipeline_artifact(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_stage text,
  p_kind text,
  p_output_reference text,
  p_payload_fingerprint text,
  p_configuration_fingerprint text,
  p_parent_output_references text[],
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_run news_clipping_private.daily_runs%rowtype;
  v_existing news_clipping_private.pipeline_artifacts%rowtype;
  v_inserted news_clipping_private.pipeline_artifacts%rowtype;
  v_parent news_clipping_private.pipeline_artifacts%rowtype;
  v_sorted_parents text[];
begin
  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-daily:' || p_run_date::text, 0)
  );

  select * into v_run
  from news_clipping_private.daily_runs
  where run_date = p_run_date
  for update;

  if not found or v_run.lease_token is null then
    raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND';
  end if;
  -- Evaluate expiry only after the lock wait, at the actual CAS boundary.
  v_now := clock_timestamp();

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
  if v_run.status <> 'running'
     or v_run.journal #>> '{run,currentStage}' is distinct from p_stage then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;

  if not (
    (p_stage = 'generate' and p_kind = 'post_generation')
    or (p_stage = 'validate' and p_kind = 'publication')
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
  end if;
  if p_output_reference is null
     or char_length(p_output_reference) not between 1 and 500
     or p_payload_fingerprint !~ '^[a-f0-9]{64}$'
     or p_configuration_fingerprint !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload ->> 'kind' is distinct from p_kind then
    raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
  end if;
  if p_parent_output_references is null
     or array_position(p_parent_output_references, null) is not null
     or exists (
       select 1
       from unnest(p_parent_output_references) as parent(output_reference)
       where char_length(output_reference) not between 1 and 500
     )
     or cardinality(p_parent_output_references) <>
       (select count(distinct output_reference)
        from unnest(p_parent_output_references) as parent(output_reference)) then
    raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
  end if;

  select coalesce(array_agg(output_reference order by output_reference), '{}'::text[])
  into v_sorted_parents
  from unnest(p_parent_output_references) as parent(output_reference);
  if p_parent_output_references is distinct from v_sorted_parents then
    raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
  end if;

  if p_stage = 'validate' then
    if cardinality(p_parent_output_references) <> 1
       or p_payload #>> '{value,generationOutputReference}'
          is distinct from p_parent_output_references[1] then
      raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
    end if;
    select * into v_parent
    from news_clipping_private.pipeline_artifacts
    where output_reference = p_parent_output_references[1];
    if not found
       or v_parent.run_id <> p_run_id
       or v_parent.stage <> 'generate'
       or v_parent.kind <> 'post_generation'
       or v_parent.payload ->> 'kind' is distinct from 'post_generation'
       or v_parent.payload #>> '{value,status}' is distinct from 'validated'
       or jsonb_typeof(v_parent.payload #> '{value,post}') is distinct from 'object'
       or v_parent.payload #> '{value,qualityResult,passed}' is distinct from 'true'::jsonb
       or p_payload #> '{value,qualityResult}'
          is distinct from v_parent.payload #> '{value,qualityResult}' then
      raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
    end if;
  end if;

  select * into v_existing
  from news_clipping_private.pipeline_artifacts
  where run_id = p_run_id and stage = p_stage;

  if found then
    if v_existing.kind is distinct from p_kind
       or v_existing.output_reference is distinct from p_output_reference
       or v_existing.payload_fingerprint is distinct from p_payload_fingerprint
       or v_existing.configuration_fingerprint is distinct from p_configuration_fingerprint
       or v_existing.parent_output_references is distinct from p_parent_output_references
       or v_existing.payload is distinct from p_payload then
      raise exception using errcode = 'P0001', message = 'OUTPUT_CONFLICT';
    end if;
    return jsonb_build_object(
      'created', false,
      'artifact', news_clipping_private.pipeline_artifact_json(v_existing)
    );
  end if;

  insert into news_clipping_private.pipeline_artifacts(
    run_id,
    stage,
    kind,
    output_reference,
    payload_fingerprint,
    configuration_fingerprint,
    parent_output_references,
    payload
  ) values (
    p_run_id,
    p_stage,
    p_kind,
    p_output_reference,
    p_payload_fingerprint,
    p_configuration_fingerprint,
    p_parent_output_references,
    p_payload
  ) returning * into v_inserted;

  return jsonb_build_object(
    'created', true,
    'artifact', news_clipping_private.pipeline_artifact_json(v_inserted)
  );
end;
$$;

create function public.get_pipeline_artifact(p_output_reference text)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, news_clipping_private
as $$
  select news_clipping_private.pipeline_artifact_json(artifact)
  from news_clipping_private.pipeline_artifacts artifact
  where artifact.output_reference = p_output_reference;
$$;

create function public.get_pipeline_artifact_for_stage(
  p_run_id text,
  p_stage text
)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, news_clipping_private
as $$
  select news_clipping_private.pipeline_artifact_json(artifact)
  from news_clipping_private.pipeline_artifacts artifact
  where artifact.run_id = p_run_id and artifact.stage = p_stage;
$$;

revoke select, insert on news_clipping_private.pipeline_artifacts from service_role;
revoke select on news_clipping_private.pipeline_artifact_parents from service_role;

revoke all on function news_clipping_private.pipeline_artifact_json(news_clipping_private.pipeline_artifacts)
  from public, anon, authenticated, service_role;
revoke all on function public.put_pipeline_artifact(date, text, text, bigint, integer, text, text, text, text, text, text[], jsonb)
  from public, anon, authenticated;
revoke all on function public.get_pipeline_artifact(text)
  from public, anon, authenticated;
revoke all on function public.get_pipeline_artifact_for_stage(text, text)
  from public, anon, authenticated;

grant execute on function public.put_pipeline_artifact(date, text, text, bigint, integer, text, text, text, text, text, text[], jsonb)
  to service_role;
grant execute on function public.get_pipeline_artifact(text)
  to service_role;
grant execute on function public.get_pipeline_artifact_for_stage(text, text)
  to service_role;

comment on function public.put_pipeline_artifact(date, text, text, bigint, integer, text, text, text, text, text, text[], jsonb) is
  'Server-only immutable artifact put. Locks the daily run and checks server-time lease, token, fence, journal revision and current stage. Exact retries return created=false; conflicts fail closed.';
comment on function public.get_pipeline_artifact(text) is
  'Server-only immutable artifact lookup by output reference.';
comment on function public.get_pipeline_artifact_for_stage(text, text) is
  'Server-only crash-recovery artifact lookup by run and stage.';

commit;
