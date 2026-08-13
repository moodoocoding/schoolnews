-- M12-SUPABASE-BUDGET-001
-- Count an unfinished model intent at its conservative reservation, but count
-- a completed intent at its exact priced audit usage. This preserves the hard
-- pre-call budget while allowing the next call to use capacity the prior call
-- did not consume. Depends on 007_model_invocation_ledger.sql.

begin;

create or replace function public.prepare_model_invocation(
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

  begin
    if jsonb_typeof(v_run.journal #> '{run,limits}') is distinct from 'object'
       or jsonb_typeof(v_run.journal #> '{run,usage}') is distinct from 'object'
       or v_run.journal #> '{run,usage,hasUnpricedCalls}' is distinct from 'false'::jsonb
       or jsonb_typeof(v_run.journal #> '{run,usage,modelCalls}') is distinct from 'number'
       or jsonb_typeof(v_run.journal #> '{run,usage,inputTokens}') is distinct from 'number'
       or jsonb_typeof(v_run.journal #> '{run,usage,outputTokens}') is distinct from 'number'
       or jsonb_typeof(v_run.journal #> '{run,usage,estimatedCostUsd}') is distinct from 'number'
       or jsonb_typeof(v_run.journal #> '{run,limits,maxModelCalls}') is distinct from 'number'
       or jsonb_typeof(v_run.journal #> '{run,limits,maxInputTokens}') is distinct from 'number'
       or jsonb_typeof(v_run.journal #> '{run,limits,maxOutputTokens}') is distinct from 'number'
       or jsonb_typeof(v_run.journal #> '{run,limits,maxEstimatedCostUsd}') is distinct from 'number'
       or exists (
         select 1
         from news_clipping_private.model_invocation_intents intent
         where intent.run_id = p_run_id
           and intent.status = 'completed'
           and (
             jsonb_typeof(intent.audit) is distinct from 'object'
             or not coalesce(intent.audit ?& array['usage','estimatedCostUsd'], false)
             or jsonb_typeof(intent.audit -> 'usage') is distinct from 'object'
             or not coalesce(
               (intent.audit -> 'usage') ?&
                 array['inputTokens','outputTokens','totalTokens'],
               false
             )
             or case
               when jsonb_typeof(intent.audit -> 'usage') = 'object' then (
                 select count(*)
                 from jsonb_object_keys(intent.audit -> 'usage') usage_key
               ) <> 3
               else true
             end
             or jsonb_typeof(intent.audit #> '{usage,inputTokens}') is distinct from 'number'
             or jsonb_typeof(intent.audit #> '{usage,outputTokens}') is distinct from 'number'
             or jsonb_typeof(intent.audit #> '{usage,totalTokens}') is distinct from 'number'
             or jsonb_typeof(intent.audit -> 'estimatedCostUsd') is distinct from 'number'
             or case
               when jsonb_typeof(intent.audit #> '{usage,inputTokens}') = 'number'
                and jsonb_typeof(intent.audit #> '{usage,outputTokens}') = 'number'
                and jsonb_typeof(intent.audit #> '{usage,totalTokens}') = 'number'
                and jsonb_typeof(intent.audit -> 'estimatedCostUsd') = 'number'
               then
                 (intent.audit #>> '{usage,inputTokens}')::bigint < 0
                 or (intent.audit #>> '{usage,outputTokens}')::bigint < 0
                 or (intent.audit #>> '{usage,totalTokens}')::bigint <
                    (intent.audit #>> '{usage,inputTokens}')::bigint +
                    (intent.audit #>> '{usage,outputTokens}')::bigint
                 or (intent.audit ->> 'estimatedCostUsd')::numeric < 0
               else true
             end
           )
       ) then
      raise exception using errcode = 'P0001', message = 'INVOCATION_BUDGET_EXCEEDED';
    end if;

    select count(*),
           coalesce(sum(
             case when status = 'reserved' then reserved_input_tokens::bigint
                  else (audit #>> '{usage,inputTokens}')::bigint end
           ), 0),
           coalesce(sum(
             case when status = 'reserved' then reserved_output_tokens::bigint
                  else (audit #>> '{usage,outputTokens}')::bigint end
           ), 0),
           coalesce(sum(
             case when status = 'reserved' then reserved_cost_usd
                  else (audit ->> 'estimatedCostUsd')::numeric end
           ), 0)
    into v_reserved_calls, v_reserved_input_tokens,
         v_reserved_output_tokens, v_reserved_cost_usd
    from news_clipping_private.model_invocation_intents
    where run_id = p_run_id;

    if v_reserved_calls < 0
       or v_reserved_input_tokens < 0
       or v_reserved_output_tokens < 0
       or v_reserved_cost_usd < 0
       or (v_run.journal #>> '{run,usage,modelCalls}')::bigint < 0
       or (v_run.journal #>> '{run,usage,inputTokens}')::bigint < 0
       or (v_run.journal #>> '{run,usage,outputTokens}')::bigint < 0
       or (v_run.journal #>> '{run,usage,estimatedCostUsd}')::numeric < 0
       or (v_run.journal #>> '{run,limits,maxModelCalls}')::bigint < 0
       or (v_run.journal #>> '{run,limits,maxInputTokens}')::bigint < 0
       or (v_run.journal #>> '{run,limits,maxOutputTokens}')::bigint < 0
       or (v_run.journal #>> '{run,limits,maxEstimatedCostUsd}')::numeric < 0 then
      raise exception using errcode = 'P0001', message = 'INVOCATION_BUDGET_EXCEEDED';
    end if;

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
  exception
    when invalid_text_representation or numeric_value_out_of_range
      or check_violation or not_null_violation then
      raise exception using errcode = 'P0001', message = 'INVOCATION_BUDGET_EXCEEDED';
  end;

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

revoke all on function public.prepare_model_invocation(date, text, text, bigint, integer, text, integer, integer, text, text, text, text, text[], text, text, integer, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.prepare_model_invocation(date, text, text, bigint, integer, text, integer, integer, text, text, text, text, text[], text, text, integer, integer, numeric)
  to service_role;

comment on function public.prepare_model_invocation(date, text, text, bigint, integer, text, integer, integer, text, text, text, text, text[], text, text, integer, integer, numeric) is
  'Server-only model-call intent reservation. Reserved intents consume their upper bounds; completed priced intents consume exact audited usage. Only status=prepared authorizes one physical provider request.';

commit;
