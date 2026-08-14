-- Rolling editorial material is also the durable identity snapshot used when a
-- provider rediscovers an article. Discovery-only sources must therefore be
-- returned with their stored article metadata even though they do not create
-- publishable evidence until a separate reviewed full-text policy exists.

begin;

do $migration$
declare
  v_signature constant regprocedure := to_regprocedure(
    'public.get_rolling_editorial_materials(date,integer)'
  );
  v_definition text;
  v_evidence_only_clause constant text :=
    E'      and source.registry_payload ->> ''contentUse'' = ''evidence''\n';
begin
  if v_signature is null then
    raise exception using errcode = 'P0001', message = 'EDITORIAL_MATERIALS_RPC_NOT_FOUND';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;
  if position(v_evidence_only_clause in v_definition) = 0
     or position(
       v_evidence_only_clause in substr(
         v_definition,
         position(v_evidence_only_clause in v_definition)
           + char_length(v_evidence_only_clause)
       )
     ) <> 0 then
    raise exception using errcode = 'P0001', message = 'EDITORIAL_MATERIALS_RPC_DEFINITION_MISMATCH';
  end if;

  execute replace(v_definition, v_evidence_only_clause, '');
end;
$migration$;

revoke all on function public.get_rolling_editorial_materials(date, integer)
  from public, anon, authenticated;
grant execute on function public.get_rolling_editorial_materials(date, integer)
  to service_role;

comment on function public.get_rolling_editorial_materials(date, integer) is
  'Returns stored article identity snapshots for all enabled allowed sources in the completed rolling window. Evidence remains limited to rows that passed its own reviewed evidence boundary.';

commit;
