-- RSS/API providers may correct display punctuation or refresh their short
-- summary after an article was first discovered. Accept those text-only
-- corrections only while the article has not entered evidence, topic or
-- publication lineage. Canonical identity and content fingerprints remain
-- immutable and are still checked by persist_collected_content.

begin;

do $migration$
declare
  v_signature constant regprocedure := to_regprocedure(
    'public.persist_collected_content(date,text,text,bigint,integer,text,jsonb,jsonb,jsonb,text,text,text,jsonb)'
  );
  v_definition text;
  v_anchor constant text :=
    E'    if found and (\n      v_existing_article.source_id is distinct from v_article ->> ''sourceId''\n';
  v_refresh_block constant text := E'    if found\n'
    || E'       and v_existing_article.source_id = v_article ->> ''sourceId''\n'
    || E'       and (\n'
    || E'         v_existing_article.title is distinct from v_article ->> ''title''\n'
    || E'         or v_existing_article.excerpt is distinct from v_article ->> ''excerpt''\n'
    || E'       )\n'
    || E'       and v_existing_article.normalized_title = v_article ->> ''normalizedTitle''\n'
    || E'       and v_existing_article.content_fingerprint = v_article ->> ''contentFingerprint''\n'
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
    || E'      set title = v_article ->> ''title'',\n'
    || E'          excerpt = v_article ->> ''excerpt''\n'
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
     or position('text-only rediscovery refresh' in v_definition) <> 0 then
    raise exception using errcode = 'P0001', message = 'PERSIST_COLLECTED_CONTENT_DEFINITION_MISMATCH';
  end if;

  execute replace(
    v_definition,
    v_anchor,
    E'    -- text-only rediscovery refresh\n' || v_refresh_block || v_anchor
  );
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
  'Persists collect rows atomically, preserves first discovery time, migrates unreferenced Naver discovery lineage, and refreshes only unreferenced display text with stable canonical identity.';

commit;
