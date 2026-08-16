-- One-time recovery for 2026-08-16, replacing the approach 043 used.
--
-- 043 restored the score step to 'running' so runDailyPipeline's
-- interrupted-step recovery would resume it. That works only when the stage
-- has no attempt recorded yet: the recovery path pushes a journal.attempts
-- entry reusing the step's attemptNumber, and score already had attempt 1
-- (the PIPELINE_VERSION_MISMATCH failure). The resulting journal violated
-- dailyRunJournalSchema on two counts -- duplicate stage/attemptNumber and
-- non-consecutive attempt numbers -- so every invocation aborted before
-- touching the run.
--
-- Use the pipeline's own retryable-failure shape instead: mark score
-- 'failed_retryable' with its existing attempt 1 metadata and leave the
-- lease expired. No step is left 'running', so the interrupted-step recovery
-- is skipped entirely and the normal stage loop simply runs score as attempt
-- 2 (1 < maxAttempts 2). journal.attempts is left untouched, so the audit
-- trail keeps the real first failure.
--
-- Fails closed unless the run is exactly the shape 043 left behind, with no
-- durable topic, publish, or model output.

begin;

do $$
declare
  v_run_id constant text := 'daily-20260816';
  v_run_date constant date := date '2026-08-16';
  v_row news_clipping_private.daily_runs%rowtype;
  v_journal jsonb;
  v_score_step jsonb;
  v_score_attempt jsonb;
  v_now timestamptz;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-daily:' || v_run_date::text, 0)
  );

  select * into v_row
  from news_clipping_private.daily_runs
  where run_date = v_run_date and run_id = v_run_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'AUGUST16_SCORE_RETRY_RUN_NOT_FOUND';
  end if;

  if v_row.status is distinct from 'running'
     or v_row.journal -> 'terminalReason' <> 'null'::jsonb
     or exists (select 1 from news_clipping_private.posts where published_by_run_id = v_run_id)
     or exists (
       select 1 from news_clipping_private.topics
       where run_id = v_run_id and selected is true
     )
     or exists (select 1 from news_clipping_private.model_calls where run_id = v_run_id)
     or exists (
       select 1 from news_clipping_private.model_invocation_intents where run_id = v_run_id
     ) then
    raise exception using errcode = 'P0001', message = 'AUGUST16_SCORE_RETRY_REFUSED';
  end if;

  v_score_step := v_row.journal #> '{run,steps,1}';
  if v_score_step is null
     or v_score_step ->> 'stage' <> 'score'
     or v_score_step ->> 'status' <> 'running'
     or (v_score_step ->> 'attemptNumber')::integer <> 1 then
    raise exception using errcode = 'P0001', message = 'AUGUST16_SCORE_RETRY_SHAPE_MISMATCH';
  end if;

  -- The first score attempt must already be journaled; its timestamps and
  -- error code are reused so the step describes that same real failure.
  select attempt into v_score_attempt
  from jsonb_array_elements(v_row.journal -> 'attempts') as attempt
  where attempt ->> 'stage' = 'score'
    and (attempt ->> 'attemptNumber')::integer = 1;

  if v_score_attempt is null
     or v_score_attempt ->> 'finishedAt' is null
     or v_score_attempt ->> 'errorCode' is null then
    raise exception using errcode = 'P0001', message = 'AUGUST16_SCORE_RETRY_ATTEMPT_MISSING';
  end if;

  v_now := clock_timestamp();
  v_journal := jsonb_set(
    v_row.journal,
    '{run,steps,1}',
    v_score_step
      || jsonb_build_object(
        'status', 'failed_retryable',
        'finishedAt', v_score_attempt -> 'finishedAt',
        'errorCode', v_score_attempt -> 'errorCode'
      )
  );

  if (v_journal #>> '{revision}')::integer <> v_row.journal_revision then
    raise exception using errcode = 'P0001', message = 'AUGUST16_SCORE_RETRY_REVISION_DRIFT';
  end if;

  update news_clipping_private.daily_runs set
    journal = v_journal,
    owner_id = 'august16-score-retry',
    lease_token = 'august16-score-retry-token',
    lease_acquired_at = v_now - interval '2 hours',
    lease_expires_at = v_now - interval '1 hour',
    updated_at = v_now
  where run_date = v_run_date and run_id = v_run_id;
end;
$$;

commit;
