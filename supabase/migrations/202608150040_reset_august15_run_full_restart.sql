-- One-time recovery for 2026-08-15. The lease-expiry recovery in 039 worked
-- (runDailyPipeline correctly resumed at score instead of re-collecting),
-- but score then failed with PIPELINE_VERSION_MISMATCH: the collect
-- artifact was written by an earlier deployment (00:28 UTC) than the one
-- serving this retry, so its configuration fingerprint no longer matched.
-- That is the pipeline's own version-drift safeguard working as intended,
-- not a new bug -- but it means the collect artifact from that first
-- attempt can no longer be trusted for reuse.
--
-- Do a full restart instead: remove the (now stale) collect artifact along
-- with the run row, exactly like 034-037, so the next Cron invocation
-- re-collects and re-scores end to end against the current deployment.
--
-- Fails closed unless the run is exactly the expected terminal shape with no
-- durable topic, publish, or model output.

begin;

do $$
declare
  v_run_id constant text := 'daily-20260815';
  v_run_date constant date := date '2026-08-15';
  v_status text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-daily:' || v_run_date::text, 0)
  );

  select status into v_status
  from news_clipping_private.daily_runs
  where run_date = v_run_date and run_id = v_run_id
  for update;

  if not found then
    return;
  end if;

  if v_status is distinct from 'blocked'
     or exists (select 1 from news_clipping_private.posts where published_by_run_id = v_run_id)
     or exists (
       select 1 from news_clipping_private.topics
       where run_id = v_run_id and selected is true
     )
     or exists (select 1 from news_clipping_private.model_calls where run_id = v_run_id)
     or exists (
       select 1 from news_clipping_private.model_invocation_intents where run_id = v_run_id
     ) then
    raise exception using errcode = 'P0001', message = 'AUGUST15_FULL_RESTART_RESET_REFUSED';
  end if;

  delete from news_clipping_private.pipeline_artifacts
  where run_id = v_run_id;

  delete from news_clipping_private.daily_runs
  where run_date = v_run_date and run_id = v_run_id;
end;
$$;

commit;
