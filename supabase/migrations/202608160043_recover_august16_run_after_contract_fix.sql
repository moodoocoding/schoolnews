-- One-time recovery for 2026-08-16 after the carried-evidence contract fix
-- (M22-CARRIED-EVIDENCE-CONTRACT-007). The stored collect artifact is valid
-- again -- read-back validation against the real production payload was
-- confirmed to pass for 8/14, 8/15 and 8/16 -- so this run only needs to be
-- put back into a resumable shape.
--
-- pipeline_artifacts is fully immutable and its foreign key forbids deleting
-- the run row, and acquire_daily_run treats any terminal status as final
-- regardless of lease expiry, so a delete-based reset is impossible here.
-- Instead restore the exact shape runDailyPipeline's interrupted-step
-- recovery already knows how to resume: status 'running', an expired lease,
-- and the score step marked as an in-flight attempt.
--
-- Fails closed unless the run is exactly the expected terminal shape with no
-- durable topic, publish, or model output.

begin;

do $$
declare
  v_run_id constant text := 'daily-20260816';
  v_run_date constant date := date '2026-08-16';
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
    raise exception using errcode = 'P0001', message = 'AUGUST16_CONTRACT_RECOVERY_RUN_NOT_FOUND';
  end if;

  if v_row.status is distinct from 'blocked'
     or v_row.journal #>> '{terminalReason}' is distinct from 'PIPELINE_VERSION_MISMATCH'
     or exists (select 1 from news_clipping_private.posts where published_by_run_id = v_run_id)
     or exists (
       select 1 from news_clipping_private.topics
       where run_id = v_run_id and selected is true
     )
     or exists (select 1 from news_clipping_private.model_calls where run_id = v_run_id)
     or exists (
       select 1 from news_clipping_private.model_invocation_intents where run_id = v_run_id
     ) then
    raise exception using errcode = 'P0001', message = 'AUGUST16_CONTRACT_RECOVERY_REFUSED';
  end if;

  v_score_step := v_row.journal #> '{run,steps,1}';
  if v_score_step is null
     or v_score_step ->> 'stage' <> 'score'
     or v_score_step ->> 'status' <> 'failed'
     or (v_score_step ->> 'attemptNumber')::integer <> 1 then
    raise exception using errcode = 'P0001', message = 'AUGUST16_CONTRACT_RECOVERY_SHAPE_MISMATCH';
  end if;

  v_now := clock_timestamp();
  v_journal := v_row.journal;
  v_journal := jsonb_set(v_journal, '{run,status}', '"running"'::jsonb);
  v_journal := jsonb_set(v_journal, '{run,currentStage}', '"score"'::jsonb);
  v_journal := jsonb_set(v_journal, '{finishedAt}', 'null'::jsonb);
  v_journal := jsonb_set(v_journal, '{terminalReason}', 'null'::jsonb);
  v_journal := jsonb_set(
    v_journal,
    '{run,steps,1}',
    v_score_step
      || jsonb_build_object(
        'status', 'running',
        'finishedAt', null,
        'errorCode', null
      )
  );

  if (v_journal #>> '{revision}')::integer <> v_row.journal_revision then
    raise exception using errcode = 'P0001', message = 'AUGUST16_CONTRACT_RECOVERY_REVISION_DRIFT';
  end if;

  update news_clipping_private.daily_runs set
    status = 'running',
    journal = v_journal,
    finished_at = null,
    owner_id = 'august16-contract-recovery',
    lease_token = 'august16-contract-recovery-token',
    lease_acquired_at = v_now - interval '2 hours',
    lease_expires_at = v_now - interval '1 hour',
    updated_at = v_now
  where run_date = v_run_date and run_id = v_run_id;
end;
$$;

commit;
