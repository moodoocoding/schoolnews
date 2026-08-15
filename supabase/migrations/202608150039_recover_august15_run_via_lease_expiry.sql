-- One-time recovery for 2026-08-15, same pattern as 038 (2026-08-14): the
-- regular 09:00 KST Cron collected successfully but was again blocked at
-- score with INVALID_SOURCE_DATA. pipeline_artifacts_run_id_fkey forbids
-- deleting the run row while the completed collect artifact exists, and
-- acquire_daily_run treats any terminal status as final regardless of lease
-- expiry, so a delete-based reset or a plain expired-lease trick would not
-- work here either.
--
-- Put the run back into the exact shape acquire_daily_run already knows how
-- to resume: status 'running' with an expired lease and the score step
-- marked 'running' as an in-flight attemptNumber 1 (matching its
-- interrupted-step recovery path; journal.attempts entries require
-- attemptNumber >= 1). This makes the next Cron invocation re-enter
-- runDailyPipeline's existing lease-recovery logic and retry the score
-- stage (1 < maxAttempts 2, so canRetry is true) instead of re-collecting,
-- now with the diagnostic logging from f8bf463/9e6591a deployed so the
-- actual failure cause can finally be read from production logs.
--
-- Fails closed unless the run is exactly the expected terminal shape with no
-- durable topic, publish, or model output.

begin;

do $$
declare
  v_run_id constant text := 'daily-20260815';
  v_run_date constant date := date '2026-08-15';
  v_row news_clipping_private.daily_runs%rowtype;
  v_journal jsonb;
  v_score_step jsonb;
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
    raise exception using errcode = 'P0001', message = 'AUGUST15_LEASE_RECOVERY_RUN_NOT_FOUND';
  end if;

  if v_row.status is distinct from 'blocked'
     or v_row.journal #>> '{terminalReason}' is distinct from 'INVALID_SOURCE_DATA'
     or exists (select 1 from news_clipping_private.posts where published_by_run_id = v_run_id)
     or exists (
       select 1 from news_clipping_private.topics
       where run_id = v_run_id and selected is true
     )
     or exists (select 1 from news_clipping_private.model_calls where run_id = v_run_id)
     or exists (
       select 1 from news_clipping_private.model_invocation_intents where run_id = v_run_id
     ) then
    raise exception using errcode = 'P0001', message = 'AUGUST15_LEASE_RECOVERY_REFUSED';
  end if;

  v_score_step := v_row.journal #> '{run,steps,1}';
  if v_score_step is null
     or v_score_step ->> 'stage' <> 'score'
     or v_score_step ->> 'status' <> 'skipped'
     or (v_score_step ->> 'attemptNumber')::integer <> 0 then
    raise exception using errcode = 'P0001', message = 'AUGUST15_LEASE_RECOVERY_SHAPE_MISMATCH';
  end if;

  v_now := clock_timestamp();
  v_journal := v_row.journal;
  v_journal := jsonb_set(v_journal, '{run,status}', '"running"'::jsonb);
  v_journal := jsonb_set(v_journal, '{run,currentStage}', '"score"'::jsonb);
  v_journal := jsonb_set(v_journal, '{finishedAt}', 'null'::jsonb);
  v_journal := jsonb_set(v_journal, '{terminalReason}', 'null'::jsonb);
  -- runDailyPipeline's interrupted-step recovery pushes a journal.attempts
  -- entry with this step's attemptNumber, and that schema requires
  -- attemptNumber >= 1 (unlike the step's own >= 0), so the step must look
  -- like an in-flight first attempt rather than attemptNumber 0.
  v_journal := jsonb_set(
    v_journal,
    '{run,steps,1}',
    v_score_step
      || jsonb_build_object(
        'status', 'running',
        'attemptNumber', 1,
        'startedAt', v_row.journal #>> '{startedAt}',
        'finishedAt', null,
        'errorCode', null
      )
  );

  if (v_journal #>> '{revision}')::integer <> v_row.journal_revision then
    raise exception using errcode = 'P0001', message = 'AUGUST15_LEASE_RECOVERY_REVISION_DRIFT';
  end if;

  update news_clipping_private.daily_runs set
    status = 'running',
    journal = v_journal,
    finished_at = null,
    owner_id = 'august15-lease-recovery',
    lease_token = 'august15-lease-recovery-token',
    lease_acquired_at = v_now - interval '2 hours',
    lease_expires_at = v_now - interval '1 hour',
    updated_at = v_now
  where run_date = v_run_date and run_id = v_run_id;
end;
$$;

commit;
