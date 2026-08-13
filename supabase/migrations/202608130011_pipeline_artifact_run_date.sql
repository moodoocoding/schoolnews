-- Bind every server-returned artifact to the authoritative daily run date so
-- publication mapping never has to infer a date from a configurable run ID.

begin;

create or replace function news_clipping_private.pipeline_artifact_json(
  p_row news_clipping_private.pipeline_artifacts
)
returns jsonb
language sql
stable
strict
security definer
set search_path = pg_catalog, news_clipping_private
as $$
  select jsonb_build_object(
    'runDate', run_row.run_date::text,
    'runId', p_row.run_id,
    'stage', p_row.stage,
    'kind', p_row.kind,
    'outputReference', p_row.output_reference,
    'payloadFingerprint', p_row.payload_fingerprint,
    'configurationFingerprint', p_row.configuration_fingerprint,
    'parentOutputReferences', to_jsonb(p_row.parent_output_references),
    'payload', p_row.payload
  )
  from news_clipping_private.daily_runs as run_row
  where run_row.run_id = p_row.run_id;
$$;

revoke all on function news_clipping_private.pipeline_artifact_json(
  news_clipping_private.pipeline_artifacts
) from public, anon, authenticated, service_role;

comment on function news_clipping_private.pipeline_artifact_json(
  news_clipping_private.pipeline_artifacts
) is
  'Private artifact envelope including the authoritative daily run date. Used only by service-role RPCs.';

commit;
