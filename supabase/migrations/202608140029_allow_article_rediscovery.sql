-- Preserve the first observed discovery timestamp while allowing a stable
-- article identity to be collected again on later runs. All durable identity,
-- source lineage, publication time and content fields remain immutable.

begin;

do $migration$
declare
  v_signature constant regprocedure := to_regprocedure(
    'public.persist_collected_content(date,text,text,bigint,integer,text,jsonb,jsonb,jsonb,text,text,text,jsonb)'
  );
  v_definition text;
  v_discovery_identity_clause constant text :=
    E'      or v_existing_article.discovered_at is distinct from (v_article ->> ''discoveredAt'')::timestamptz\n';
begin
  if v_signature is null then
    raise exception using errcode = 'P0001', message = 'PERSIST_COLLECTED_CONTENT_NOT_FOUND';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  if position(v_discovery_identity_clause in v_definition) = 0
     or position(
       v_discovery_identity_clause in
       substr(
         v_definition,
         position(v_discovery_identity_clause in v_definition)
           + char_length(v_discovery_identity_clause)
       )
     ) <> 0 then
    raise exception using errcode = 'P0001', message = 'PERSIST_COLLECTED_CONTENT_DEFINITION_MISMATCH';
  end if;

  execute replace(v_definition, v_discovery_identity_clause, '');
end;
$migration$;

revoke all on function public.persist_collected_content(
  date, text, text, bigint, integer, text, jsonb, jsonb, jsonb,
  text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_collected_content(
  date, text, text, bigint, integer, text, jsonb, jsonb, jsonb,
  text, text, text, jsonb
) to service_role;

comment on function public.persist_collected_content(
  date, text, text, bigint, integer, text, jsonb, jsonb, jsonb,
  text, text, text, jsonb
) is
  'Persists collect domain rows and artifact atomically. Recollection preserves the stored first-discovered timestamp instead of treating a later observation as an identity conflict.';

commit;
