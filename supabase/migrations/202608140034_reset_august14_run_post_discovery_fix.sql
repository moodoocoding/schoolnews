-- One-time recovery after applying 033. The 2026-08-14 run failed again at
-- collect (INVALID_SOURCE_DATA) before the discovery-editorial-materials fix
-- landed. Remove only the exact 2026-08-14 terminal failure when it has no
-- durable topic, artifact, model or publish output. Any observable work
-- makes this migration fail closed.

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
    raise exception using errcode = 'P0001', message = 'AUGUST14_POST_DISCOVERY_FIX_RESET_REFUSED';
  end if;

  delete from news_clipping_private.daily_runs
  where run_date = v_run_date and run_id = v_run_id;
end;
$$;

commit;
