-- M10-MODEL-LEDGER-001
-- Server-only, fail-closed intent ledger for physical model invocations.
-- Depends on 001 core, 002 workspace RPCs, 003 atomic score artifacts and
-- 005 model_calls.route_attempt. Apply only after those migrations.

begin;

create table news_clipping_private.model_invocation_intents (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references news_clipping_private.daily_runs(run_id) on delete restrict,
  purpose text not null check (purpose in ('draft', 'revision', 'semantic_review')),
  attempt_number smallint not null check (attempt_number between 1 and 2),
  route_attempt smallint not null check (route_attempt between 1 and 2),
  call_id text not null unique check (call_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provider_id text not null check (provider_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  model_id text not null check (char_length(btrim(model_id)) between 1 and 160),
  prompt_version text not null check (char_length(btrim(prompt_version)) between 1 and 64),
  evidence_ids text[] not null check (
    cardinality(evidence_ids) >= 1
    and array_position(evidence_ids, null) is null
  ),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  score_output_reference text not null check (char_length(score_output_reference) between 1 and 500),
  reserved_input_tokens integer not null check (reserved_input_tokens >= 0),
  reserved_output_tokens integer not null check (reserved_output_tokens >= 0),
  reserved_cost_usd numeric(14,8) not null check (reserved_cost_usd >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'completed')),
  reserved_fence bigint not null check (reserved_fence >= 1),
  reserved_journal_revision integer not null check (reserved_journal_revision >= 0),
  reserved_at timestamptz not null,
  completed_at timestamptz,
  model_call_id text references news_clipping_private.model_calls(call_id) on delete restrict,
  audit jsonb check (audit is null or jsonb_typeof(audit) = 'object'),
  unique (run_id, purpose, attempt_number, route_attempt),
  constraint model_invocation_intent_completion_shape check (
    (status = 'reserved' and completed_at is null and model_call_id is null and audit is null)
    or
    (status = 'completed' and completed_at is not null and model_call_id = call_id and audit is not null)
  )
);

alter table news_clipping_private.model_invocation_intents enable row level security;
alter table news_clipping_private.model_invocation_intents force row level security;

create function news_clipping_private.guard_model_invocation_intent_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, news_clipping_private
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD';
  end if;
  if old.status <> 'reserved'
     or new.status <> 'completed'
     or new.id is distinct from old.id
     or new.run_id is distinct from old.run_id
     or new.purpose is distinct from old.purpose
     or new.attempt_number is distinct from old.attempt_number
     or new.route_attempt is distinct from old.route_attempt
     or new.call_id is distinct from old.call_id
     or new.provider_id is distinct from old.provider_id
     or new.model_id is distinct from old.model_id
     or new.prompt_version is distinct from old.prompt_version
     or new.evidence_ids is distinct from old.evidence_ids
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.score_output_reference is distinct from old.score_output_reference
     or new.reserved_input_tokens is distinct from old.reserved_input_tokens
     or new.reserved_output_tokens is distinct from old.reserved_output_tokens
     or new.reserved_cost_usd is distinct from old.reserved_cost_usd
     or new.reserved_fence is distinct from old.reserved_fence
     or new.reserved_journal_revision is distinct from old.reserved_journal_revision
     or new.reserved_at is distinct from old.reserved_at
     or new.completed_at is null
     or new.model_call_id is distinct from old.call_id
     or new.audit is null then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD';
  end if;
  return new;
end;
$$;

create trigger model_invocation_intents_are_put_once
before update or delete on news_clipping_private.model_invocation_intents
for each row execute function news_clipping_private.guard_model_invocation_intent_mutation();

create trigger model_call_evidence_is_immutable
before update or delete on news_clipping_private.model_call_evidence
for each row execute function news_clipping_private.reject_immutable_row_mutation();

create function public.prepare_model_invocation(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_purpose text,
  p_attempt_number integer,
  p_route_attempt integer,
  p_call_id text,
  p_provider_id text,
  p_model_id text,
  p_prompt_version text,
  p_evidence_ids text[],
  p_request_fingerprint text,
  p_score_output_reference text,
  p_reserved_input_tokens integer,
  p_reserved_output_tokens integer,
  p_reserved_cost_usd numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_run news_clipping_private.daily_runs%rowtype;
  v_existing news_clipping_private.model_invocation_intents%rowtype;
  v_inserted news_clipping_private.model_invocation_intents%rowtype;
  v_score news_clipping_private.pipeline_artifacts%rowtype;
  v_score_evidence_ids text[];
  v_reserved_calls bigint;
  v_reserved_input_tokens bigint;
  v_reserved_output_tokens bigint;
  v_reserved_cost_usd numeric;
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
  if v_run.status <> 'running'
     or v_run.journal #>> '{run,currentStage}' is distinct from 'generate' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;

  if not coalesce(p_purpose in ('draft', 'revision', 'semantic_review'), false)
     or p_attempt_number not between 1 and 2
     or p_route_attempt not between 1 and 2
     or not coalesce(p_call_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false)
     or not coalesce(p_provider_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false)
     or char_length(btrim(p_model_id)) not between 1 and 160
     or char_length(btrim(p_prompt_version)) not between 1 and 64
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or char_length(p_score_output_reference) not between 1 and 500
     or p_reserved_input_tokens is null or p_reserved_input_tokens < 0
     or p_reserved_output_tokens is null or p_reserved_output_tokens < 0
     or p_reserved_cost_usd is null or p_reserved_cost_usd < 0
     or p_evidence_ids is null
     or cardinality(p_evidence_ids) < 1
     or array_position(p_evidence_ids, null) is not null
     or cardinality(p_evidence_ids) <>
       (select count(distinct evidence_id) from unnest(p_evidence_ids) evidence_id)
     or exists (
       select 1 from unnest(p_evidence_ids) as requested(evidence_id)
       where not coalesce(requested.evidence_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false)
          or not exists (
            select 1 from news_clipping_private.evidence_items evidence
            where evidence.id = requested.evidence_id
          )
     ) then
    raise exception using errcode = 'P0001', message = 'INVALID_INVOCATION_INPUT';
  end if;

  select * into v_score
  from news_clipping_private.pipeline_artifacts
  where run_id = p_run_id and stage = 'score';
  if not found
     or v_score.kind is distinct from 'topic_selection'
     or v_score.output_reference is distinct from p_score_output_reference
     or v_score.payload #>> '{value,outcome}' is distinct from 'eligible'
     or jsonb_typeof(v_score.payload #> '{value,evidenceItems}') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_INVOCATION_LINEAGE';
  end if;
  select array_agg(value ->> 'evidenceId' order by ordinality)
  into v_score_evidence_ids
  from jsonb_array_elements(v_score.payload #> '{value,evidenceItems}')
    with ordinality item(value, ordinality);
  if v_score_evidence_ids is distinct from p_evidence_ids then
    raise exception using errcode = 'P0001', message = 'INVALID_INVOCATION_LINEAGE';
  end if;

  select * into v_existing
  from news_clipping_private.model_invocation_intents
  where run_id = p_run_id
    and purpose = p_purpose
    and attempt_number = p_attempt_number
    and route_attempt = p_route_attempt
  for update;
  if found then
    if v_existing.call_id is distinct from p_call_id
       or v_existing.provider_id is distinct from p_provider_id
       or v_existing.model_id is distinct from p_model_id
       or v_existing.prompt_version is distinct from p_prompt_version
       or v_existing.evidence_ids is distinct from p_evidence_ids
       or v_existing.request_fingerprint is distinct from p_request_fingerprint
       or v_existing.score_output_reference is distinct from p_score_output_reference
       or v_existing.reserved_input_tokens is distinct from p_reserved_input_tokens
       or v_existing.reserved_output_tokens is distinct from p_reserved_output_tokens
       or v_existing.reserved_cost_usd is distinct from p_reserved_cost_usd then
      raise exception using errcode = 'P0001', message = 'INVOCATION_CONFLICT';
    end if;
    if v_existing.status = 'completed' then
      return jsonb_build_object(
        'status', 'completed',
        'runId', v_existing.run_id,
        'callId', v_existing.call_id,
        'purpose', v_existing.purpose,
        'attemptNumber', v_existing.attempt_number,
        'routeAttempt', v_existing.route_attempt,
        'requestFingerprint', v_existing.request_fingerprint,
        'audit', v_existing.audit
      );
    end if;
    return jsonb_build_object(
      'status', 'reserved',
      'runId', v_existing.run_id,
      'callId', v_existing.call_id,
      'purpose', v_existing.purpose,
      'attemptNumber', v_existing.attempt_number,
      'routeAttempt', v_existing.route_attempt,
      'requestFingerprint', v_existing.request_fingerprint,
      'reservedAt', news_clipping_private.iso_json(v_existing.reserved_at)
    );
  end if;

  if jsonb_typeof(v_run.journal #> '{run,limits}') is distinct from 'object'
     or jsonb_typeof(v_run.journal #> '{run,usage}') is distinct from 'object'
     or v_run.journal #> '{run,usage,hasUnpricedCalls}' is distinct from 'false'::jsonb then
    raise exception using errcode = 'P0001', message = 'INVOCATION_BUDGET_EXCEEDED';
  end if;
  select count(*),
         coalesce(sum(reserved_input_tokens), 0),
         coalesce(sum(reserved_output_tokens), 0),
         coalesce(sum(reserved_cost_usd), 0)
  into v_reserved_calls, v_reserved_input_tokens,
       v_reserved_output_tokens, v_reserved_cost_usd
  from news_clipping_private.model_invocation_intents
  where run_id = p_run_id;
  if (v_run.journal #>> '{run,usage,modelCalls}')::bigint + v_reserved_calls + 1 >
       (v_run.journal #>> '{run,limits,maxModelCalls}')::bigint
     or (v_run.journal #>> '{run,usage,inputTokens}')::bigint
          + v_reserved_input_tokens + p_reserved_input_tokens >
       (v_run.journal #>> '{run,limits,maxInputTokens}')::bigint
     or (v_run.journal #>> '{run,usage,outputTokens}')::bigint
          + v_reserved_output_tokens + p_reserved_output_tokens >
       (v_run.journal #>> '{run,limits,maxOutputTokens}')::bigint
     or (v_run.journal #>> '{run,usage,estimatedCostUsd}')::numeric
          + v_reserved_cost_usd + p_reserved_cost_usd >
       (v_run.journal #>> '{run,limits,maxEstimatedCostUsd}')::numeric then
    raise exception using errcode = 'P0001', message = 'INVOCATION_BUDGET_EXCEEDED';
  end if;

  insert into news_clipping_private.model_invocation_intents(
    run_id, purpose, attempt_number, route_attempt, call_id,
    provider_id, model_id, prompt_version, evidence_ids, request_fingerprint,
    score_output_reference, reserved_input_tokens, reserved_output_tokens,
    reserved_cost_usd,
    status, reserved_fence, reserved_journal_revision, reserved_at
  ) values (
    p_run_id, p_purpose, p_attempt_number, p_route_attempt, p_call_id,
    p_provider_id, p_model_id, p_prompt_version, p_evidence_ids, p_request_fingerprint,
    p_score_output_reference, p_reserved_input_tokens, p_reserved_output_tokens,
    p_reserved_cost_usd,
    'reserved', p_fence, p_expected_revision, v_now
  ) returning * into v_inserted;

  return jsonb_build_object(
    'status', 'prepared',
    'runId', v_inserted.run_id,
    'callId', v_inserted.call_id,
    'purpose', v_inserted.purpose,
    'attemptNumber', v_inserted.attempt_number,
    'routeAttempt', v_inserted.route_attempt,
    'requestFingerprint', v_inserted.request_fingerprint,
    'reservedAt', news_clipping_private.iso_json(v_inserted.reserved_at)
  );
exception
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'INVOCATION_CONFLICT';
  when invalid_text_representation or numeric_value_out_of_range
    or check_violation or not_null_violation or foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'INVALID_INVOCATION_INPUT';
end;
$$;

create function public.finalize_model_invocation(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_purpose text,
  p_attempt_number integer,
  p_route_attempt integer,
  p_call_id text,
  p_request_fingerprint text,
  p_audit jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_run news_clipping_private.daily_runs%rowtype;
  v_intent news_clipping_private.model_invocation_intents%rowtype;
  v_usage jsonb;
  v_updated_count integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-daily:' || p_run_date::text, 0)
  );
  select * into v_run
  from news_clipping_private.daily_runs
  where run_date = p_run_date
  for update;
  v_now := clock_timestamp();

  if not found or v_run.lease_token is null then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_run.run_id <> p_run_id then raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH'; end if;
  if v_run.lease_token <> p_lease_token then raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH'; end if;
  if v_run.fence <> p_fence then raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH'; end if;
  if v_run.journal_revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION'; end if;
  if v_run.lease_expires_at is null or v_run.lease_expires_at <= v_now then raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED'; end if;
  if v_run.status <> 'running'
     or v_run.journal #>> '{run,currentStage}' is distinct from 'generate' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;

  select * into v_intent
  from news_clipping_private.model_invocation_intents
  where run_id = p_run_id
    and purpose = p_purpose
    and attempt_number = p_attempt_number
    and route_attempt = p_route_attempt
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'INVOCATION_NOT_FOUND';
  end if;
  if v_intent.call_id is distinct from p_call_id
     or v_intent.request_fingerprint is distinct from p_request_fingerprint
     or v_intent.reserved_fence is distinct from p_fence
     or v_intent.reserved_journal_revision is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'INVOCATION_CONFLICT';
  end if;
  if v_intent.status = 'completed' then
    if v_intent.audit is distinct from p_audit then
      raise exception using errcode = 'P0001', message = 'INVOCATION_CONFLICT';
    end if;
    return jsonb_build_object(
      'status', 'completed', 'created', false,
      'runId', v_intent.run_id, 'callId', v_intent.call_id,
      'purpose', v_intent.purpose, 'attemptNumber', v_intent.attempt_number,
      'routeAttempt', v_intent.route_attempt,
      'requestFingerprint', v_intent.request_fingerprint,
      'audit', v_intent.audit
    );
  end if;

  if jsonb_typeof(p_audit) is distinct from 'object'
     or not (p_audit ?& array[
       'callId','attemptNumber','routeAttempt','purpose','providerId','modelId',
       'promptVersion','startedAt','finishedAt','evidenceIds','usage',
       'estimatedCostUsd','finishReason','responseId'
     ])
     or (select count(*) from jsonb_object_keys(p_audit)) <> 14
     or jsonb_typeof(p_audit -> 'callId') is distinct from 'string'
     or jsonb_typeof(p_audit -> 'attemptNumber') is distinct from 'number'
     or jsonb_typeof(p_audit -> 'routeAttempt') is distinct from 'number'
     or jsonb_typeof(p_audit -> 'purpose') is distinct from 'string'
     or jsonb_typeof(p_audit -> 'providerId') is distinct from 'string'
     or jsonb_typeof(p_audit -> 'modelId') is distinct from 'string'
     or jsonb_typeof(p_audit -> 'promptVersion') is distinct from 'string'
     or jsonb_typeof(p_audit -> 'startedAt') is distinct from 'string'
     or jsonb_typeof(p_audit -> 'finishedAt') is distinct from 'string'
     or jsonb_typeof(p_audit -> 'evidenceIds') is distinct from 'array'
     or jsonb_typeof(p_audit -> 'usage') is distinct from 'object'
     or jsonb_typeof(p_audit -> 'estimatedCostUsd') not in ('number', 'null')
     or jsonb_typeof(p_audit -> 'finishReason') not in ('string', 'null')
     or jsonb_typeof(p_audit -> 'responseId') not in ('string', 'null') then
    raise exception using errcode = 'P0001', message = 'INVALID_INVOCATION_AUDIT';
  end if;

  v_usage := p_audit -> 'usage';
  if not (v_usage ?& array['inputTokens','outputTokens','totalTokens'])
     or (select count(*) from jsonb_object_keys(v_usage)) <> 3
     or jsonb_typeof(v_usage -> 'inputTokens') is distinct from 'number'
     or jsonb_typeof(v_usage -> 'outputTokens') is distinct from 'number'
     or jsonb_typeof(v_usage -> 'totalTokens') is distinct from 'number'
     or not coalesce((
       select bool_and(jsonb_typeof(value) = 'string')
       from jsonb_array_elements(p_audit -> 'evidenceIds') item(value)
     ), false) then
    raise exception using errcode = 'P0001', message = 'INVALID_INVOCATION_AUDIT';
  end if;

  if p_audit ->> 'callId' is distinct from v_intent.call_id
     or p_audit ->> 'purpose' is distinct from v_intent.purpose
     or (p_audit ->> 'attemptNumber') !~ '^[12]$'
     or (p_audit ->> 'routeAttempt') !~ '^[12]$'
     or (p_audit ->> 'attemptNumber')::integer is distinct from v_intent.attempt_number::integer
     or (p_audit ->> 'routeAttempt')::integer is distinct from v_intent.route_attempt::integer
     or p_audit ->> 'providerId' is distinct from v_intent.provider_id
     or p_audit ->> 'modelId' is distinct from v_intent.model_id
     or p_audit ->> 'promptVersion' is distinct from v_intent.prompt_version
     or (select array_agg(value #>> '{}' order by ordinality)
         from jsonb_array_elements(p_audit -> 'evidenceIds') with ordinality item(value, ordinality))
        is distinct from v_intent.evidence_ids
     or (v_usage ->> 'inputTokens')::integer < 0
     or (v_usage ->> 'outputTokens')::integer < 0
     or (v_usage ->> 'inputTokens') !~ '^[0-9]+$'
     or (v_usage ->> 'outputTokens') !~ '^[0-9]+$'
     or (v_usage ->> 'totalTokens') !~ '^[0-9]+$'
     or (v_usage ->> 'totalTokens')::integer <
       (v_usage ->> 'inputTokens')::integer + (v_usage ->> 'outputTokens')::integer
     or (p_audit ->> 'startedAt')::timestamptz > (p_audit ->> 'finishedAt')::timestamptz
     or char_length(p_audit ->> 'finishReason') > 80
     or char_length(p_audit ->> 'responseId') > 256
     or (
       p_audit -> 'estimatedCostUsd' = 'null'::jsonb
       or (p_audit ->> 'estimatedCostUsd')::numeric < 0
       or (p_audit ->> 'estimatedCostUsd')::numeric > v_intent.reserved_cost_usd
     ) then
    raise exception using errcode = 'P0001', message = 'INVALID_INVOCATION_AUDIT';
  end if;
  if (v_usage ->> 'inputTokens')::integer > v_intent.reserved_input_tokens
     or (v_usage ->> 'outputTokens')::integer > v_intent.reserved_output_tokens then
    raise exception using errcode = 'P0001', message = 'INVOCATION_BUDGET_EXCEEDED';
  end if;

  insert into news_clipping_private.model_calls(
    call_id, run_id, artifact_id, attempt_number, route_attempt, purpose,
    provider_id, model_id, prompt_version, started_at, finished_at,
    evidence_ids, input_tokens, output_tokens, total_tokens,
    estimated_cost_usd, finish_reason, response_id, created_at
  ) values (
    v_intent.call_id, v_intent.run_id, null, v_intent.attempt_number,
    v_intent.route_attempt, v_intent.purpose, v_intent.provider_id,
    v_intent.model_id, v_intent.prompt_version,
    (p_audit ->> 'startedAt')::timestamptz,
    (p_audit ->> 'finishedAt')::timestamptz,
    v_intent.evidence_ids,
    (v_usage ->> 'inputTokens')::integer,
    (v_usage ->> 'outputTokens')::integer,
    (v_usage ->> 'totalTokens')::integer,
    (p_audit ->> 'estimatedCostUsd')::numeric,
    p_audit ->> 'finishReason', p_audit ->> 'responseId', v_now
  );

  insert into news_clipping_private.model_call_evidence(call_id, evidence_id)
  select v_intent.call_id, evidence_id
  from unnest(v_intent.evidence_ids) evidence_id;

  update news_clipping_private.model_invocation_intents
  set status = 'completed', completed_at = v_now,
      model_call_id = v_intent.call_id, audit = p_audit
  where id = v_intent.id and status = 'reserved';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception using errcode = 'P0001', message = 'INVOCATION_CONFLICT';
  end if;

  return jsonb_build_object(
    'status', 'completed', 'created', true,
    'runId', v_intent.run_id, 'callId', v_intent.call_id,
    'purpose', v_intent.purpose, 'attemptNumber', v_intent.attempt_number,
    'routeAttempt', v_intent.route_attempt,
    'requestFingerprint', v_intent.request_fingerprint,
    'audit', p_audit
  );
exception
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'INVOCATION_CONFLICT';
  when invalid_text_representation or datetime_field_overflow
    or numeric_value_out_of_range or check_violation or not_null_violation
    or foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'INVALID_INVOCATION_AUDIT';
end;
$$;

create function news_clipping_private.validate_generation_model_audits()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_audit jsonb;
  v_intent news_clipping_private.model_invocation_intents%rowtype;
  v_audit_count integer := 0;
  v_input_tokens bigint := 0;
  v_output_tokens bigint := 0;
  v_cost_usd numeric := 0;
begin
  if new.stage <> 'generate' or new.kind <> 'post_generation' then
    return new;
  end if;
  if jsonb_typeof(new.payload #> '{value,audits}') is distinct from 'array'
     or jsonb_array_length(new.payload #> '{value,audits}') < 1
     or jsonb_typeof(new.payload #> '{value,usage}') is distinct from 'object'
     or new.payload #> '{value,usage,hasUnpricedCalls}' is distinct from 'false'::jsonb then
    raise exception using errcode = 'P0001', message = 'INVALID_MODEL_AUDIT_LINEAGE';
  end if;

  for v_audit in
    select value from jsonb_array_elements(new.payload #> '{value,audits}') item(value)
  loop
    select * into v_intent
    from news_clipping_private.model_invocation_intents
    where call_id = v_audit ->> 'callId';
    if not found
       or v_intent.run_id is distinct from new.run_id
       or v_intent.status is distinct from 'completed'
       or v_intent.audit is distinct from v_audit
       or not exists (
         select 1 from news_clipping_private.model_calls model_call
         where model_call.call_id = v_intent.call_id
           and model_call.run_id = new.run_id
           and model_call.artifact_id is null
       ) then
      raise exception using errcode = 'P0001', message = 'INVALID_MODEL_AUDIT_LINEAGE';
    end if;
    v_audit_count := v_audit_count + 1;
    v_input_tokens := v_input_tokens + (v_audit #>> '{usage,inputTokens}')::integer;
    v_output_tokens := v_output_tokens + (v_audit #>> '{usage,outputTokens}')::integer;
    v_cost_usd := v_cost_usd + (v_audit ->> 'estimatedCostUsd')::numeric;
  end loop;

  if v_audit_count <> (
       select count(distinct value ->> 'callId')
       from jsonb_array_elements(new.payload #> '{value,audits}') item(value)
     )
     or v_audit_count <> (
       select count(*) from news_clipping_private.model_invocation_intents intent
       where intent.run_id = new.run_id
     )
     or exists (
       select 1 from news_clipping_private.model_invocation_intents intent
       where intent.run_id = new.run_id and intent.status <> 'completed'
     )
     or (new.payload #>> '{value,usage,modelCalls}')::integer <> v_audit_count
     or (new.payload #>> '{value,usage,inputTokens}')::bigint <> v_input_tokens
     or (new.payload #>> '{value,usage,outputTokens}')::bigint <> v_output_tokens
     or (new.payload #>> '{value,usage,estimatedCostUsd}')::numeric <> v_cost_usd then
    raise exception using errcode = 'P0001', message = 'INVALID_MODEL_AUDIT_LINEAGE';
  end if;
  return new;
exception
  when invalid_text_representation or numeric_value_out_of_range
    or check_violation or not_null_violation then
    raise exception using errcode = 'P0001', message = 'INVALID_MODEL_AUDIT_LINEAGE';
end;
$$;

create trigger pipeline_artifact_model_audit_guard
before insert on news_clipping_private.pipeline_artifacts
for each row execute function news_clipping_private.validate_generation_model_audits();

create or replace function news_clipping_private.reject_immutable_row_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, news_clipping_private
as $$
begin
  if tg_table_name = 'model_calls' and tg_op = 'UPDATE' then
    if old.artifact_id is null
       and new.artifact_id is not null
       and (to_jsonb(new) - 'artifact_id') is not distinct from
           (to_jsonb(old) - 'artifact_id')
       and exists (
         select 1 from news_clipping_private.pipeline_artifacts artifact
         where artifact.id = new.artifact_id
           and artifact.run_id = old.run_id
           and artifact.stage = 'generate'
           and artifact.kind = 'post_generation'
       ) then
      return new;
    end if;
  end if;
  raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD';
end;
$$;

create function news_clipping_private.bind_generation_model_calls()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_updated_count integer;
begin
  if new.stage = 'generate' and new.kind = 'post_generation' then
    update news_clipping_private.model_calls model_call
    set artifact_id = new.id
    where model_call.call_id in (
      select value ->> 'callId'
      from jsonb_array_elements(new.payload #> '{value,audits}') item(value)
    )
      and model_call.run_id = new.run_id
      and model_call.artifact_id is null;
    get diagnostics v_updated_count = row_count;
    if v_updated_count <> jsonb_array_length(new.payload #> '{value,audits}') then
      raise exception using errcode = 'P0001', message = 'INVALID_MODEL_AUDIT_LINEAGE';
    end if;
  end if;
  return new;
end;
$$;

create trigger pipeline_artifact_bind_model_calls
after insert on news_clipping_private.pipeline_artifacts
for each row execute function news_clipping_private.bind_generation_model_calls();

create function public.get_model_invocation(
  p_run_id text,
  p_purpose text,
  p_attempt_number integer,
  p_route_attempt integer
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_result jsonb;
begin
  if not coalesce(p_run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false)
     or not coalesce(p_purpose in ('draft', 'revision', 'semantic_review'), false)
     or p_attempt_number not between 1 and 2
     or p_route_attempt not between 1 and 2 then
    raise exception using errcode = 'P0001', message = 'INVALID_INVOCATION_INPUT';
  end if;

  select jsonb_strip_nulls(jsonb_build_object(
      'status', intent.status,
      'runId', intent.run_id,
      'callId', intent.call_id,
      'purpose', intent.purpose,
      'attemptNumber', intent.attempt_number,
      'routeAttempt', intent.route_attempt,
      'requestFingerprint', intent.request_fingerprint,
      'reservedAt', news_clipping_private.iso_json(intent.reserved_at),
      'completedAt', case when intent.completed_at is null then null
        else news_clipping_private.iso_json(intent.completed_at) end,
      'audit', intent.audit
    )) into v_result
  from news_clipping_private.model_invocation_intents intent
  where intent.run_id = p_run_id
    and intent.purpose = p_purpose
    and intent.attempt_number = p_attempt_number
    and intent.route_attempt = p_route_attempt;
  return v_result;
end;
$$;

revoke select, insert, update, delete on news_clipping_private.model_calls
  from public, anon, authenticated, service_role;
revoke select, insert, update, delete on news_clipping_private.model_call_evidence
  from public, anon, authenticated, service_role;
revoke all on news_clipping_private.model_invocation_intents
  from public, anon, authenticated, service_role;

revoke all on function news_clipping_private.guard_model_invocation_intent_mutation()
  from public, anon, authenticated, service_role;
revoke all on function news_clipping_private.validate_generation_model_audits()
  from public, anon, authenticated, service_role;
revoke all on function news_clipping_private.bind_generation_model_calls()
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_model_invocation(date, text, text, bigint, integer, text, integer, integer, text, text, text, text, text[], text, text, integer, integer, numeric)
  from public, anon, authenticated;
revoke all on function public.finalize_model_invocation(date, text, text, bigint, integer, text, integer, integer, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.get_model_invocation(text, text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.prepare_model_invocation(date, text, text, bigint, integer, text, integer, integer, text, text, text, text, text[], text, text, integer, integer, numeric)
  to service_role;
grant execute on function public.finalize_model_invocation(date, text, text, bigint, integer, text, integer, integer, text, text, jsonb)
  to service_role;
grant execute on function public.get_model_invocation(text, text, integer, integer)
  to service_role;

comment on function public.prepare_model_invocation(date, text, text, bigint, integer, text, integer, integer, text, text, text, text, text[], text, text, integer, integer, numeric) is
  'Server-only model-call intent reservation. Only status=prepared authorizes one physical provider request; reserved means fail closed and completed returns reusable audit.';
comment on function public.finalize_model_invocation(date, text, text, bigint, integer, text, integer, integer, text, text, jsonb) is
  'Server-only reserved-to-completed CAS. Persists exact ModelCallAudit and evidence relations after rechecking the live generate lease.';
comment on function public.get_model_invocation(text, text, integer, integer) is
  'Server-only crash-recovery lookup. A reserved result never authorizes a repeated provider request.';

commit;
