-- When the Naver adapter moved from discovery-only `naver-news-*` sources to
-- reviewed API-summary `naver-summary-*` sources, canonical article IDs stayed
-- URL-based. Migrate only unreferenced discovery rows in place during their
-- first reviewed recollection; published, selected or evidenced rows remain
-- immutable and fail closed.

begin;

do $migration$
declare
  v_signature constant regprocedure := to_regprocedure(
    'public.persist_collected_content(date,text,text,bigint,integer,text,jsonb,jsonb,jsonb,text,text,text,jsonb)'
  );
  v_definition text;
  v_anchor constant text :=
    E'    if found and (\n      v_existing_article.source_id is distinct from v_article ->> ''sourceId''\n';
  v_migration_block constant text := E'    if found\n'
    || E'       and v_existing_article.source_id like ''naver-news-%''\n'
    || E'       and v_article ->> ''sourceId'' = regexp_replace(\n'
    || E'         v_existing_article.source_id, ''^naver-news-'', ''naver-summary-''\n'
    || E'       )\n'
    || E'       and v_existing_article.excerpt is null\n'
    || E'       and nullif(btrim(v_article ->> ''excerpt''), '''') is not null\n'
    || E'       and v_existing_article.origin_type in (''unknown'', ''wire'')\n'
    || E'       and v_article ->> ''originType'' in (''original_reporting'', ''wire'')\n'
    || E'       and not exists (\n'
    || E'         select 1 from news_clipping_private.evidence_items\n'
    || E'         where article_id = v_existing_article.id\n'
    || E'       )\n'
    || E'       and not exists (\n'
    || E'         select 1 from news_clipping_private.topic_articles\n'
    || E'         where article_id = v_existing_article.id\n'
    || E'       )\n'
    || E'       and not exists (\n'
    || E'         select 1 from news_clipping_private.post_sources\n'
    || E'         where article_id = v_existing_article.id\n'
    || E'       ) then\n'
    || E'      update news_clipping_private.articles\n'
    || E'      set source_id = v_article ->> ''sourceId'',\n'
    || E'          excerpt = v_article ->> ''excerpt'',\n'
    || E'          origin_type = v_article ->> ''originType''\n'
    || E'      where id = v_existing_article.id\n'
    || E'      returning * into v_existing_article;\n'
    || E'    end if;\n\n';
begin
  if v_signature is null then
    raise exception using errcode = 'P0001', message = 'PERSIST_COLLECTED_CONTENT_NOT_FOUND';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;
  if position(v_anchor in v_definition) = 0
     or position(
       v_anchor in substr(
         v_definition,
         position(v_anchor in v_definition) + char_length(v_anchor)
       )
     ) <> 0
     or position('naver-summary-' in v_definition) <> 0 then
    raise exception using errcode = 'P0001', message = 'PERSIST_COLLECTED_CONTENT_DEFINITION_MISMATCH';
  end if;

  execute replace(v_definition, v_anchor, v_migration_block || v_anchor);
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
  'Persists collect rows atomically, preserves first discovery time, and migrates only unreferenced Naver discovery rows to reviewed API-summary lineage on exact canonical recollection.';

commit;
