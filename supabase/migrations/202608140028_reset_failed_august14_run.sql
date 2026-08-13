-- One-time recovery for the 05:13 KST collection failure. The replacement
-- pipeline can continue with persisted rolling materials when every live
-- source is temporarily unavailable. Refuse any run that produced outputs.

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

  if v_status is distinct from 'failed'
     or exists (select 1 from news_clipping_private.posts where published_by_run_id = v_run_id)
     or exists (select 1 from news_clipping_private.topics where run_id = v_run_id)
     or exists (select 1 from news_clipping_private.pipeline_artifacts where run_id = v_run_id)
     or exists (select 1 from news_clipping_private.model_calls where run_id = v_run_id)
     or exists (
       select 1 from news_clipping_private.model_invocation_intents where run_id = v_run_id
     ) then
    raise exception using errcode = 'P0001', message = 'FAILED_RUN_RESET_REFUSED';
  end if;

  delete from news_clipping_private.daily_runs
  where run_date = v_run_date and run_id = v_run_id;
end;
$$;

commit;
