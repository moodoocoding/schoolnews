-- One-time, test-only reset of the unpublished 2026-08-14 run so the newly
-- scheduled 05:00 KST production cron can exercise the pipeline. This refuses
-- to touch a published/modelled run and preserves source request throttles.

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

  if v_status is distinct from 'succeeded_without_publish'
     or exists (
       select 1 from news_clipping_private.posts
       where published_by_run_id = v_run_id
     )
     or exists (
       select 1 from news_clipping_private.model_calls
       where run_id = v_run_id
     )
     or exists (
       select 1 from news_clipping_private.model_invocation_intents
       where run_id = v_run_id
     ) then
    raise exception using errcode = 'P0001', message = 'TEST_RUN_RESET_REFUSED';
  end if;

  delete from news_clipping_private.topic_evidence
  where topic_id in (
    select id from news_clipping_private.topics where run_id = v_run_id
  );
  delete from news_clipping_private.topic_articles
  where topic_id in (
    select id from news_clipping_private.topics where run_id = v_run_id
  );
  delete from news_clipping_private.topics where run_id = v_run_id;

  -- These two immutable tables contain only disposable outputs for this
  -- unpublished, zero-model-call test run. Disable their named guards only
  -- inside this transaction and restore them before commit.
  alter table news_clipping_private.pipeline_artifact_parents
    disable trigger pipeline_artifact_parents_are_immutable;
  alter table news_clipping_private.pipeline_artifacts
    disable trigger pipeline_artifacts_are_immutable;

  delete from news_clipping_private.pipeline_artifact_parents
  where child_artifact_id in (
      select id from news_clipping_private.pipeline_artifacts where run_id = v_run_id
    )
     or parent_artifact_id in (
      select id from news_clipping_private.pipeline_artifacts where run_id = v_run_id
    );
  delete from news_clipping_private.pipeline_artifacts where run_id = v_run_id;

  alter table news_clipping_private.pipeline_artifacts
    enable trigger pipeline_artifacts_are_immutable;
  alter table news_clipping_private.pipeline_artifact_parents
    enable trigger pipeline_artifact_parents_are_immutable;

  delete from news_clipping_private.daily_runs
  where run_date = v_run_date and run_id = v_run_id;
end;
$$;

commit;
