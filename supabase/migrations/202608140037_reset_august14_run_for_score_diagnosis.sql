-- One-time recovery to re-run 2026-08-14 with the new unexpected-persistence-
-- failure logging (asDailyPersistenceError) deployed, so the actual cause of
-- the repeated score-stage INVALID_SOURCE_DATA can be read from production
-- logs. Remove only the exact 2026-08-14 terminal failure when it has no
-- selected topic, publish, or model output. Any observable work makes this
-- migration fail closed. pipeline_artifacts_run_id_fkey forces the
-- completed collect artifact to be removed together with the run row, so
-- the next attempt re-collects rather than reusing it (unlike the original
-- plan of keeping it for reuse).

begin;

do $$
declare
  v_run_id constant text := 'daily-20260814';
  v_run_date constant date := date '2026-08-14';
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
    raise exception using errcode = 'P0001', message = 'AUGUST14_SCORE_DIAGNOSIS_RESET_REFUSED';
  end if;

  delete from news_clipping_private.pipeline_artifacts
  where run_id = v_run_id;

  delete from news_clipping_private.daily_runs
  where run_date = v_run_date and run_id = v_run_id;
end;
$$;

commit;
