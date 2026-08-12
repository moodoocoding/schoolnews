-- M7-SUPABASE-CONTENT-001
-- Atomic, idempotent server-only persistence for collected content and topics.
-- No private table is exposed through the Data API.

begin;

alter table news_clipping_private.sources
  add column registry_payload jsonb;

alter table news_clipping_private.topics
  add column candidate_payload jsonb;

create function public.persist_collected_content(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_current_stage text,
  p_sources jsonb,
  p_articles jsonb,
  p_evidence_items jsonb,
  p_artifact_output_reference text,
  p_artifact_payload_fingerprint text,
  p_artifact_configuration_fingerprint text,
  p_artifact_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_run news_clipping_private.daily_runs%rowtype;
  v_source jsonb;
  v_article jsonb;
  v_evidence jsonb;
  v_existing_source news_clipping_private.sources%rowtype;
  v_existing_article news_clipping_private.articles%rowtype;
  v_existing_evidence news_clipping_private.evidence_items%rowtype;
  v_existing_artifact news_clipping_private.pipeline_artifacts%rowtype;
  v_inserted_artifact news_clipping_private.pipeline_artifacts%rowtype;
  v_collision_ids text[];
  v_article_mapping jsonb := '[]'::jsonb;
  v_evidence_mapping jsonb := '[]'::jsonb;
  v_artifact_created boolean := false;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-daily:' || p_run_date::text, 0)
  );
  select * into v_run
  from news_clipping_private.daily_runs
  where run_date = p_run_date
  for update;
  v_now := clock_timestamp();

  if not found or v_run.lease_token is null then
    raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND';
  end if;
  if v_run.run_id <> p_run_id then
    raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH';
  end if;
  if v_run.lease_token <> p_lease_token then
    raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH';
  end if;
  if v_run.fence <> p_fence then
    raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH';
  end if;
  if v_run.journal_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION';
  end if;
  if v_run.lease_expires_at is null or v_run.lease_expires_at <= v_now then
    raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED';
  end if;
  if p_current_stage is distinct from 'collect'
     or v_run.status <> 'running'
     or v_run.journal #>> '{run,currentStage}' is distinct from 'collect' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;

  if jsonb_typeof(p_sources) is distinct from 'array'
     or jsonb_array_length(p_sources) < 1
     or jsonb_typeof(p_articles) is distinct from 'array'
     or jsonb_typeof(p_evidence_items) is distinct from 'array'
     or jsonb_typeof(p_artifact_payload) is distinct from 'object'
     or p_artifact_payload ->> 'kind' is distinct from 'news_ingestion'
     or p_artifact_payload #> '{value,articles}' is distinct from p_articles
     or p_artifact_payload #> '{value,evidenceItems}' is distinct from p_evidence_items
     or char_length(p_artifact_output_reference) not between 1 and 500
     or p_artifact_payload_fingerprint !~ '^[a-f0-9]{64}$'
     or p_artifact_configuration_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_PAYLOAD';
  end if;
  if (select count(*) <> count(distinct value ->> 'sourceId') from jsonb_array_elements(p_sources))
     or (select count(*) <> count(distinct value ->> 'articleId') from jsonb_array_elements(p_articles))
     or (select count(*) <> count(distinct value ->> 'canonicalUrlHash') from jsonb_array_elements(p_articles))
     or (select count(*) <> count(distinct value ->> 'contentFingerprint') from jsonb_array_elements(p_articles))
     or (select count(*) <> count(distinct value ->> 'evidenceId') from jsonb_array_elements(p_evidence_items)) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_CONTENT_IDENTITY';
  end if;

  for v_source in select value from jsonb_array_elements(p_sources) as item(value) loop
    if jsonb_typeof(v_source) <> 'object'
       or coalesce((v_source ->> 'sourceId') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
       or char_length(btrim(v_source ->> 'name')) not between 1 and 200
       or coalesce((v_source ->> 'publisherGroupId') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
       or coalesce((v_source ->> 'provenanceGroupPrefix') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
       or not coalesce(v_source ->> 'publisherType' in ('official','news','wire','research','other'), false)
       or not coalesce(v_source ->> 'collectionType' in ('rss','api','html'), false)
       or not coalesce(v_source ->> 'originType' in ('primary_document','original_reporting','wire','press_release_rewrite','unknown'), false)
       or not coalesce(v_source ->> 'sourceRole' in ('primary','independent','supporting'), false)
       or not coalesce(v_source ->> 'sourceType' in ('primary','news','research'), false)
       or not coalesce(v_source ->> 'authority' in ('none','public_authority_direct_fact'), false)
       or v_source ->> 'accessStatus' is distinct from 'allowed'
       or v_source -> 'enabled' is distinct from 'true'::jsonb
       or not coalesce((v_source ->> 'siteUrl') ~ '^https://', false)
       or not coalesce((v_source ->> 'feedUrl') ~ '^https://', false) then
      raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_PAYLOAD';
    end if;

    select * into v_existing_source
    from news_clipping_private.sources
    where id = v_source ->> 'sourceId'
    for update;
    if found and (
      v_existing_source.name is distinct from v_source ->> 'name'
      or v_existing_source.publisher_group_id is distinct from v_source ->> 'publisherGroupId'
      or v_existing_source.provenance_group_key is distinct from v_source ->> 'provenanceGroupPrefix'
      or v_existing_source.publisher_type is distinct from v_source ->> 'publisherType'
      or v_existing_source.collection_type is distinct from v_source ->> 'collectionType'
      or v_existing_source.canonical_base_url is distinct from v_source ->> 'siteUrl'
      or v_existing_source.terms_reviewed_at is distinct from (v_source ->> 'accessReviewedAt')::timestamptz
      or v_existing_source.enabled is distinct from true
      or v_existing_source.registry_payload is distinct from v_source
    ) then
      raise exception using errcode = 'P0001', message = 'SOURCE_IDENTITY_CONFLICT';
    end if;

    insert into news_clipping_private.sources(
      id, name, publisher_group_id, provenance_group_key, publisher_type,
      collection_type, canonical_base_url, terms_reviewed_at, enabled,
      registry_payload, created_at, updated_at
    ) values (
      v_source ->> 'sourceId', v_source ->> 'name',
      v_source ->> 'publisherGroupId', v_source ->> 'provenanceGroupPrefix',
      v_source ->> 'publisherType', v_source ->> 'collectionType',
      v_source ->> 'siteUrl', (v_source ->> 'accessReviewedAt')::timestamptz,
      true, v_source, v_now, v_now
    )
    on conflict (id) do nothing;
  end loop;

  for v_article in select value from jsonb_array_elements(p_articles) as item(value) loop
    if jsonb_typeof(v_article) <> 'object'
       or coalesce((v_article ->> 'articleId') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
       or coalesce((v_article ->> 'sourceId') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
       or not coalesce((v_article ->> 'originalUrl') ~ '^https://', false)
       or not coalesce((v_article ->> 'canonicalUrl') ~ '^https://', false)
       or not coalesce((v_article ->> 'canonicalUrlHash') ~ '^[a-f0-9]{64}$', false)
       or not coalesce((v_article ->> 'contentFingerprint') ~ '^[a-f0-9]{64}$', false)
       or char_length(btrim(v_article ->> 'title')) not between 1 and 500
       or char_length(btrim(v_article ->> 'normalizedTitle')) not between 1 and 500
       or not coalesce(v_article ->> 'publishedAtPrecision' in ('date','instant'), false)
       or not coalesce(v_article ->> 'originType' in ('primary_document','original_reporting','wire','press_release_rewrite','unknown'), false)
       or not exists (
         select 1 from jsonb_array_elements(p_sources) source(value)
         where source.value ->> 'sourceId' = v_article ->> 'sourceId'
       ) then
      raise exception using errcode = 'P0001', message = 'UNKNOWN_SOURCE';
    end if;
    select * into v_existing_source
    from news_clipping_private.sources
    where id = v_article ->> 'sourceId';
    if not found
       or v_existing_source.publisher_group_id is distinct from v_article ->> 'publisherGroupId'
       or v_existing_source.registry_payload ->> 'originType' is distinct from v_article ->> 'originType'
       or position((v_existing_source.provenance_group_key || ':') in (v_article ->> 'provenanceGroupKey')) <> 1 then
      raise exception using errcode = 'P0001', message = 'UNKNOWN_SOURCE';
    end if;

    select array_agg(distinct id order by id) into v_collision_ids
    from news_clipping_private.articles
    where id = v_article ->> 'articleId'
       or canonical_url_hash = v_article ->> 'canonicalUrlHash'
       or content_fingerprint = v_article ->> 'contentFingerprint'
       or (
         source_id = v_article ->> 'sourceId'
         and external_id is not distinct from v_article ->> 'externalId'
         and external_id is not null
       );
    if cardinality(v_collision_ids) > 1
       or (cardinality(v_collision_ids) = 1 and v_collision_ids[1] <> v_article ->> 'articleId') then
      raise exception using errcode = 'P0001', message = 'ARTICLE_IDENTITY_CONFLICT';
    end if;

    select * into v_existing_article
    from news_clipping_private.articles
    where id = v_article ->> 'articleId'
    for update;
    if found and (
      v_existing_article.source_id is distinct from v_article ->> 'sourceId'
      or v_existing_article.external_id is distinct from v_article ->> 'externalId'
      or v_existing_article.original_url is distinct from v_article ->> 'originalUrl'
      or v_existing_article.canonical_url is distinct from v_article ->> 'canonicalUrl'
      or v_existing_article.canonical_url_hash is distinct from v_article ->> 'canonicalUrlHash'
      or v_existing_article.title is distinct from v_article ->> 'title'
      or v_existing_article.normalized_title is distinct from v_article ->> 'normalizedTitle'
      or v_existing_article.excerpt is distinct from v_article ->> 'excerpt'
      or v_existing_article.author is distinct from v_article ->> 'author'
      or v_existing_article.publisher is distinct from v_article ->> 'publisher'
      or v_existing_article.content_fingerprint is distinct from v_article ->> 'contentFingerprint'
      or v_existing_article.publisher_group_id is distinct from v_article ->> 'publisherGroupId'
      or v_existing_article.provenance_group_key is distinct from v_article ->> 'provenanceGroupKey'
      or v_existing_article.published_at is distinct from (v_article ->> 'publishedAt')::timestamptz
      or v_existing_article.published_at_precision is distinct from v_article ->> 'publishedAtPrecision'
      or v_existing_article.discovered_at is distinct from (v_article ->> 'discoveredAt')::timestamptz
      or v_existing_article.canonicalization_version is distinct from v_article ->> 'canonicalizationVersion'
      or v_existing_article.fingerprint_version is distinct from v_article ->> 'fingerprintVersion'
      or v_existing_article.origin_type is distinct from v_article ->> 'originType'
    ) then
      raise exception using errcode = 'P0001', message = 'ARTICLE_IDENTITY_CONFLICT';
    end if;
    if not found then
      insert into news_clipping_private.articles(
        id, source_id, external_id, original_url, canonical_url,
        canonical_url_hash, title, normalized_title, excerpt, author,
        publisher, publisher_group_id, provenance_group_key, published_at,
        published_at_precision, discovered_at, content_fingerprint,
        canonicalization_version, fingerprint_version, origin_type, collected_at
      ) values (
        v_article ->> 'articleId', v_article ->> 'sourceId', v_article ->> 'externalId',
        v_article ->> 'originalUrl', v_article ->> 'canonicalUrl',
        v_article ->> 'canonicalUrlHash', v_article ->> 'title',
        v_article ->> 'normalizedTitle', v_article ->> 'excerpt',
        v_article ->> 'author', v_article ->> 'publisher',
        v_article ->> 'publisherGroupId', v_article ->> 'provenanceGroupKey',
        (v_article ->> 'publishedAt')::timestamptz,
        v_article ->> 'publishedAtPrecision',
        (v_article ->> 'discoveredAt')::timestamptz,
        v_article ->> 'contentFingerprint',
        v_article ->> 'canonicalizationVersion', v_article ->> 'fingerprintVersion',
        v_article ->> 'originType', v_now
      );
    end if;
    v_article_mapping := v_article_mapping || jsonb_build_array(jsonb_build_object(
      'inputArticleId', v_article ->> 'articleId',
      'storedArticleId', v_article ->> 'articleId'
    ));
  end loop;

  for v_evidence in select value from jsonb_array_elements(p_evidence_items) as item(value) loop
    if jsonb_typeof(v_evidence) <> 'object'
       or coalesce((v_evidence ->> 'evidenceId') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
       or coalesce((v_evidence ->> 'articleId') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
       or coalesce((v_evidence ->> 'sourceId') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
       or not coalesce((v_evidence ->> 'passageHash') ~ '^[a-f0-9]{64}$', false)
       or not coalesce(v_evidence ->> 'sourceRole' in ('primary','independent','supporting'), false)
       or not coalesce(v_evidence ->> 'sourceType' in ('primary','news','research'), false)
       or not coalesce(v_evidence ->> 'authority' in ('none','public_authority_direct_fact'), false)
       or char_length(btrim(v_evidence ->> 'passage')) not between 1 and 2000
       or not exists (
         select 1 from jsonb_array_elements(p_articles) article(value)
         where article.value ->> 'articleId' = v_evidence ->> 'articleId'
           and article.value ->> 'sourceId' = v_evidence ->> 'sourceId'
       ) then
      raise exception using errcode = 'P0001', message = 'MISSING_CONTENT_LINEAGE';
    end if;
    select * into v_existing_article
    from news_clipping_private.articles
    where id = v_evidence ->> 'articleId';
    select * into v_existing_source
    from news_clipping_private.sources
    where id = v_evidence ->> 'sourceId';
    if v_existing_article.id is null
       or v_existing_source.id is null
       or v_existing_article.source_id is distinct from v_existing_source.id
       or v_evidence ->> 'title' is distinct from v_existing_article.title
       or v_evidence ->> 'url' is distinct from v_existing_article.canonical_url
       or v_evidence ->> 'publisherGroupId' is distinct from v_existing_article.publisher_group_id
       or v_evidence ->> 'provenanceGroupKey' is distinct from v_existing_article.provenance_group_key
       or v_evidence ->> 'sourceName' is distinct from v_existing_source.name
       or v_evidence ->> 'sourceRole' is distinct from v_existing_source.registry_payload ->> 'sourceRole'
       or v_evidence ->> 'sourceType' is distinct from v_existing_source.registry_payload ->> 'sourceType'
       or (v_evidence ->> 'publishedAt')::timestamptz is distinct from v_existing_article.published_at
       or v_evidence ->> 'publishedAtPrecision' is distinct from v_existing_article.published_at_precision
       or (
         v_evidence ->> 'authority' = 'public_authority_direct_fact'
         and (
           v_existing_source.registry_payload ->> 'authority' is distinct from 'public_authority_direct_fact'
           or v_evidence ->> 'locator' = 'RSS 요약'
         )
       ) then
      raise exception using errcode = 'P0001', message = 'MISSING_CONTENT_LINEAGE';
    end if;

    select array_agg(distinct id order by id) into v_collision_ids
    from news_clipping_private.evidence_items
    where id = v_evidence ->> 'evidenceId'
       or (article_id = v_evidence ->> 'articleId' and passage_hash = v_evidence ->> 'passageHash');
    if cardinality(v_collision_ids) > 1
       or (cardinality(v_collision_ids) = 1 and v_collision_ids[1] <> v_evidence ->> 'evidenceId') then
      raise exception using errcode = 'P0001', message = 'EVIDENCE_IDENTITY_CONFLICT';
    end if;
    select * into v_existing_evidence
    from news_clipping_private.evidence_items
    where id = v_evidence ->> 'evidenceId'
    for update;
    if found and (
      v_existing_evidence.id is distinct from v_evidence ->> 'evidenceId'
      or v_existing_evidence.article_id is distinct from v_evidence ->> 'articleId'
      or v_existing_evidence.source_id is distinct from v_evidence ->> 'sourceId'
      or v_existing_evidence.passage_id is distinct from v_evidence ->> 'passageId'
      or v_existing_evidence.passage_hash is distinct from v_evidence ->> 'passageHash'
      or v_existing_evidence.publisher_group_id is distinct from v_evidence ->> 'publisherGroupId'
      or v_existing_evidence.provenance_group_key is distinct from v_evidence ->> 'provenanceGroupKey'
      or v_existing_evidence.source_role is distinct from v_evidence ->> 'sourceRole'
      or v_existing_evidence.source_type is distinct from v_evidence ->> 'sourceType'
      or v_existing_evidence.authority is distinct from v_evidence ->> 'authority'
      or v_existing_evidence.source_name is distinct from v_evidence ->> 'sourceName'
      or v_existing_evidence.title is distinct from v_evidence ->> 'title'
      or v_existing_evidence.url is distinct from v_evidence ->> 'url'
      or v_existing_evidence.published_at is distinct from (v_evidence ->> 'publishedAt')::timestamptz
      or v_existing_evidence.published_at_precision is distinct from v_evidence ->> 'publishedAtPrecision'
      or v_existing_evidence.passage is distinct from v_evidence ->> 'passage'
      or v_existing_evidence.locator is distinct from v_evidence ->> 'locator'
    ) then
      raise exception using errcode = 'P0001', message = 'EVIDENCE_IDENTITY_CONFLICT';
    end if;
    if not found then
      insert into news_clipping_private.evidence_items(
        id, article_id, source_id, passage_id, passage_hash,
        publisher_group_id, provenance_group_key, source_role, source_type,
        authority, source_name, title, url, published_at,
        published_at_precision, passage, locator, created_at
      ) values (
        v_evidence ->> 'evidenceId', v_evidence ->> 'articleId',
        v_evidence ->> 'sourceId', v_evidence ->> 'passageId',
        v_evidence ->> 'passageHash', v_evidence ->> 'publisherGroupId',
        v_evidence ->> 'provenanceGroupKey', v_evidence ->> 'sourceRole',
        v_evidence ->> 'sourceType', v_evidence ->> 'authority',
        v_evidence ->> 'sourceName', v_evidence ->> 'title',
        v_evidence ->> 'url', (v_evidence ->> 'publishedAt')::timestamptz,
        v_evidence ->> 'publishedAtPrecision', v_evidence ->> 'passage',
        v_evidence ->> 'locator', v_now
      );
    end if;
    v_evidence_mapping := v_evidence_mapping || jsonb_build_array(jsonb_build_object(
      'inputEvidenceId', v_evidence ->> 'evidenceId',
      'storedEvidenceId', v_evidence ->> 'evidenceId'
    ));
  end loop;

  if exists (
    select 1 from news_clipping_private.pipeline_artifacts
    where output_reference = p_artifact_output_reference
      and (run_id <> p_run_id or stage <> 'collect')
  ) then
    raise exception using errcode = 'P0001', message = 'OUTPUT_CONFLICT';
  end if;
  select * into v_existing_artifact
  from news_clipping_private.pipeline_artifacts
  where run_id = p_run_id and stage = 'collect';
  if found then
    if v_existing_artifact.kind is distinct from 'news_ingestion'
       or v_existing_artifact.output_reference is distinct from p_artifact_output_reference
       or v_existing_artifact.payload_fingerprint is distinct from p_artifact_payload_fingerprint
       or v_existing_artifact.configuration_fingerprint is distinct from p_artifact_configuration_fingerprint
       or v_existing_artifact.parent_output_references is distinct from '{}'::text[]
       or v_existing_artifact.payload is distinct from p_artifact_payload then
      raise exception using errcode = 'P0001', message = 'OUTPUT_CONFLICT';
    end if;
  else
    insert into news_clipping_private.pipeline_artifacts(
      run_id, stage, kind, output_reference, payload_fingerprint,
      configuration_fingerprint, parent_output_references, payload
    ) values (
      p_run_id, 'collect', 'news_ingestion', p_artifact_output_reference,
      p_artifact_payload_fingerprint, p_artifact_configuration_fingerprint,
      '{}'::text[], p_artifact_payload
    ) returning * into v_inserted_artifact;
    v_existing_artifact := v_inserted_artifact;
    v_artifact_created := true;
  end if;

  return jsonb_build_object(
    'created', v_artifact_created,
    'articleIdMapping', v_article_mapping,
    'evidenceIdMapping', v_evidence_mapping,
    'artifactOutputReference', v_existing_artifact.output_reference
  );
exception
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'ARTICLE_IDENTITY_CONFLICT';
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range
    or check_violation or not_null_violation or foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_PAYLOAD';
end;
$$;

create function public.persist_empty_topic_selection(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_current_stage text,
  p_collect_output_reference text,
  p_artifact_output_reference text,
  p_artifact_payload_fingerprint text,
  p_artifact_configuration_fingerprint text,
  p_artifact_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_run news_clipping_private.daily_runs%rowtype;
  v_collect_artifact news_clipping_private.pipeline_artifacts%rowtype;
  v_existing_artifact news_clipping_private.pipeline_artifacts%rowtype;
  v_inserted_artifact news_clipping_private.pipeline_artifacts%rowtype;
  v_created boolean := false;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-daily:' || p_run_date::text, 0)
  );
  select * into v_run
  from news_clipping_private.daily_runs
  where run_date = p_run_date
  for update;
  v_now := clock_timestamp();
  if not found or v_run.lease_token is null then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_run.run_id <> p_run_id then raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH'; end if;
  if v_run.lease_token <> p_lease_token then raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH'; end if;
  if v_run.fence <> p_fence then raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH'; end if;
  if v_run.journal_revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION'; end if;
  if v_run.lease_expires_at is null or v_run.lease_expires_at <= v_now then raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED'; end if;
  if p_current_stage is distinct from 'score'
     or v_run.status <> 'running'
     or v_run.journal #>> '{run,currentStage}' is distinct from 'score' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;

  if p_artifact_payload is distinct from jsonb_build_object(
       'kind', 'topic_selection',
       'value', jsonb_build_object(
         'outcome', 'none', 'candidate', null, 'evidenceItems', '[]'::jsonb
       )
     )
     or char_length(p_collect_output_reference) not between 1 and 500
     or char_length(p_artifact_output_reference) not between 1 and 500
     or p_artifact_payload_fingerprint !~ '^[a-f0-9]{64}$'
     or p_artifact_configuration_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_PAYLOAD';
  end if;

  select * into v_collect_artifact
  from news_clipping_private.pipeline_artifacts
  where run_id = p_run_id and stage = 'collect'
  for update;
  if not found
     or v_collect_artifact.kind is distinct from 'news_ingestion'
     or v_collect_artifact.output_reference is distinct from p_collect_output_reference then
    raise exception using errcode = 'P0001', message = 'MISSING_CONTENT_LINEAGE';
  end if;
  if exists (
    select 1 from news_clipping_private.topics
    where run_date = p_run_date or run_id = p_run_id
  ) then
    raise exception using errcode = 'P0001', message = 'TOPIC_IDENTITY_CONFLICT';
  end if;

  if exists (
    select 1 from news_clipping_private.pipeline_artifacts
    where output_reference = p_artifact_output_reference
      and (run_id <> p_run_id or stage <> 'score')
  ) then
    raise exception using errcode = 'P0001', message = 'OUTPUT_CONFLICT';
  end if;
  select * into v_existing_artifact
  from news_clipping_private.pipeline_artifacts
  where run_id = p_run_id and stage = 'score';
  if found then
    if v_existing_artifact.kind is distinct from 'topic_selection'
       or v_existing_artifact.output_reference is distinct from p_artifact_output_reference
       or v_existing_artifact.payload_fingerprint is distinct from p_artifact_payload_fingerprint
       or v_existing_artifact.configuration_fingerprint is distinct from p_artifact_configuration_fingerprint
       or v_existing_artifact.parent_output_references is distinct from array[p_collect_output_reference]
       or v_existing_artifact.payload is distinct from p_artifact_payload then
      raise exception using errcode = 'P0001', message = 'OUTPUT_CONFLICT';
    end if;
  else
    insert into news_clipping_private.pipeline_artifacts(
      run_id, stage, kind, output_reference, payload_fingerprint,
      configuration_fingerprint, parent_output_references, payload
    ) values (
      p_run_id, 'score', 'topic_selection', p_artifact_output_reference,
      p_artifact_payload_fingerprint, p_artifact_configuration_fingerprint,
      array[p_collect_output_reference], p_artifact_payload
    ) returning * into v_inserted_artifact;
    v_existing_artifact := v_inserted_artifact;
    v_created := true;
  end if;

  return jsonb_build_object(
    'created', v_created,
    'outcome', 'none',
    'artifactOutputReference', v_existing_artifact.output_reference
  );
exception
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'OUTPUT_CONFLICT';
  when invalid_text_representation or numeric_value_out_of_range
    or check_violation or not_null_violation or foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_PAYLOAD';
end;
$$;

create function public.persist_selected_topic(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_current_stage text,
  p_topic_title text,
  p_candidate jsonb,
  p_article_id_mapping jsonb,
  p_evidence_id_mapping jsonb,
  p_collect_output_reference text,
  p_artifact_output_reference text,
  p_artifact_payload_fingerprint text,
  p_artifact_configuration_fingerprint text,
  p_artifact_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz;
  v_run news_clipping_private.daily_runs%rowtype;
  v_existing news_clipping_private.topics%rowtype;
  v_selected news_clipping_private.topics%rowtype;
  v_collect_artifact news_clipping_private.pipeline_artifacts%rowtype;
  v_existing_artifact news_clipping_private.pipeline_artifacts%rowtype;
  v_inserted_artifact news_clipping_private.pipeline_artifacts%rowtype;
  v_expected_title text;
  v_input_article_ids text[];
  v_candidate_article_ids text[];
  v_stored_article_ids text[];
  v_input_evidence_ids text[];
  v_candidate_evidence_ids text[];
  v_new_fact_evidence_ids text[];
  v_stored_evidence_ids text[];
  v_existing_article_ids text[];
  v_existing_evidence_ids text[];
  v_topic_existed boolean := false;
  v_artifact_existed boolean := false;
  v_created boolean := false;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-daily:' || p_run_date::text, 0)
  );
  select * into v_run
  from news_clipping_private.daily_runs
  where run_date = p_run_date
  for update;
  v_now := clock_timestamp();
  if not found or v_run.lease_token is null then
    raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND';
  end if;
  if v_run.run_id <> p_run_id then raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH'; end if;
  if v_run.lease_token <> p_lease_token then raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH'; end if;
  if v_run.fence <> p_fence then raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH'; end if;
  if v_run.journal_revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION'; end if;
  if v_run.lease_expires_at is null or v_run.lease_expires_at <= v_now then raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED'; end if;
  if p_current_stage is distinct from 'score'
     or v_run.status <> 'running'
     or v_run.journal #>> '{run,currentStage}' is distinct from 'score' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;

  if jsonb_typeof(p_candidate) is distinct from 'object'
     or jsonb_typeof(p_candidate -> 'articleIds') is distinct from 'array'
     or jsonb_array_length(p_candidate -> 'articleIds') < 1
     or jsonb_typeof(p_candidate -> 'evidenceIds') is distinct from 'array'
     or jsonb_array_length(p_candidate -> 'evidenceIds') < 1
     or jsonb_typeof(p_candidate -> 'newFactEvidenceIds') is distinct from 'array'
     or jsonb_array_length(p_candidate -> 'newFactEvidenceIds') < 1
     or jsonb_typeof(p_article_id_mapping) is distinct from 'array'
     or jsonb_typeof(p_evidence_id_mapping) is distinct from 'array'
     or jsonb_typeof(p_artifact_payload) is distinct from 'object'
     or p_artifact_payload ->> 'kind' is distinct from 'topic_selection'
     or p_artifact_payload #>> '{value,outcome}' is distinct from 'eligible'
     or p_artifact_payload #> '{value,candidate}' is distinct from p_candidate
     or jsonb_typeof(p_artifact_payload #> '{value,evidenceItems}') is distinct from 'array'
     or char_length(p_collect_output_reference) not between 1 and 500
     or char_length(p_artifact_output_reference) not between 1 and 500
     or p_artifact_payload_fingerprint !~ '^[a-f0-9]{64}$'
     or p_artifact_configuration_fingerprint !~ '^[a-f0-9]{64}$'
     or char_length(btrim(p_topic_title)) not between 1 and 500
     or coalesce((p_candidate ->> 'topicId') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
     or char_length(btrim(p_candidate ->> 'selectionReason')) not between 1 and 1000
     or not coalesce(p_candidate ->> 'evidencePolicy' in (
       'primary_plus_independent','two_independent_sources','authoritative_single_source'
     ), false)
     or p_candidate #> '{independence,passed}' is distinct from 'true'::jsonb
     or coalesce((p_candidate #>> '{score,total}')::integer < 70, true)
     or coalesce((p_candidate #>> '{score,elementaryRelevance}')::integer < 18, true)
     or coalesce((p_candidate #>> '{score,aiDigitalSpecificity}')::integer < 10, true)
     or coalesce((p_candidate #>> '{score,reliability}')::integer < 12, true)
     or coalesce((p_candidate #>> '{score,novelty}')::integer < 10, true) then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_PAYLOAD';
  end if;

  select array_agg(value #>> '{}' order by value #>> '{}') into v_candidate_article_ids
  from jsonb_array_elements(p_candidate -> 'articleIds') item(value);
  select array_agg(value ->> 'inputArticleId' order by value ->> 'inputArticleId'),
         array_agg(value ->> 'storedArticleId' order by value ->> 'storedArticleId')
  into v_input_article_ids, v_stored_article_ids
  from jsonb_array_elements(p_article_id_mapping) item(value);
  select array_agg(value #>> '{}' order by value #>> '{}') into v_candidate_evidence_ids
  from jsonb_array_elements(p_candidate -> 'evidenceIds') item(value);
  select array_agg(value #>> '{}' order by value #>> '{}') into v_new_fact_evidence_ids
  from jsonb_array_elements(p_candidate -> 'newFactEvidenceIds') item(value);
  select array_agg(value ->> 'inputEvidenceId' order by value ->> 'inputEvidenceId'),
         array_agg(value ->> 'storedEvidenceId' order by value ->> 'storedEvidenceId')
  into v_input_evidence_ids, v_stored_evidence_ids
  from jsonb_array_elements(p_evidence_id_mapping) item(value);

  select * into v_collect_artifact
  from news_clipping_private.pipeline_artifacts
  where run_id = p_run_id and stage = 'collect'
  for update;
  if not found
     or v_collect_artifact.kind is distinct from 'news_ingestion'
     or v_collect_artifact.output_reference is distinct from p_collect_output_reference then
    raise exception using errcode = 'P0001', message = 'MISSING_CONTENT_LINEAGE';
  end if;

  if v_candidate_article_ids is distinct from v_input_article_ids
     or v_candidate_evidence_ids is distinct from v_input_evidence_ids
     or v_input_article_ids is distinct from v_stored_article_ids
     or v_input_evidence_ids is distinct from v_stored_evidence_ids
     or not (v_new_fact_evidence_ids <@ v_candidate_evidence_ids)
     or cardinality(v_input_article_ids) <> (select count(distinct value) from unnest(v_input_article_ids) value)
     or cardinality(v_input_evidence_ids) <> (select count(distinct value) from unnest(v_input_evidence_ids) value)
     or exists (
       select 1 from unnest(v_stored_article_ids) article_id
       where not exists (
         select 1
         from jsonb_array_elements(v_collect_artifact.payload #> '{value,articles}') item(value)
         where item.value ->> 'articleId' = article_id
       )
     )
     or not coalesce(
       (p_artifact_payload #> '{value,evidenceItems}')
         <@ (v_collect_artifact.payload #> '{value,evidenceItems}'),
       false
     )
     or (select array_agg(value ->> 'evidenceId' order by value ->> 'evidenceId')
         from jsonb_array_elements(p_artifact_payload #> '{value,evidenceItems}') item(value))
        is distinct from v_candidate_evidence_ids
     or exists (
       select 1 from unnest(v_stored_evidence_ids) evidence_id
       left join news_clipping_private.evidence_items evidence on evidence.id = evidence_id
       where evidence.id is null or not (evidence.article_id = any(v_stored_article_ids))
     ) then
    raise exception using errcode = 'P0001', message = 'MISSING_CONTENT_LINEAGE';
  end if;

  select article.title into v_expected_title
  from news_clipping_private.articles article
  where article.id = any(v_stored_article_ids)
  order by article.published_at desc, article.id asc
  limit 1;
  if v_expected_title is null or p_topic_title is distinct from v_expected_title then
    raise exception using errcode = 'P0001', message = 'TOPIC_TITLE_MISMATCH';
  end if;

  select * into v_selected
  from news_clipping_private.topics
  where run_date = p_run_date and selected
  for update;
  if found and v_selected.id <> p_candidate ->> 'topicId' then
    raise exception using errcode = 'P0001', message = 'TOPIC_IDENTITY_CONFLICT';
  end if;
  select * into v_existing
  from news_clipping_private.topics
  where id = p_candidate ->> 'topicId'
  for update;
  v_topic_existed := found;
  if exists (
    select 1 from news_clipping_private.pipeline_artifacts
    where output_reference = p_artifact_output_reference
      and (run_id <> p_run_id or stage <> 'score')
  ) then
    raise exception using errcode = 'P0001', message = 'OUTPUT_CONFLICT';
  end if;
  select * into v_existing_artifact
  from news_clipping_private.pipeline_artifacts
  where run_id = p_run_id and stage = 'score';
  v_artifact_existed := found;
  if v_topic_existed is distinct from v_artifact_existed then
    raise exception using errcode = 'P0001', message = 'OUTPUT_CONFLICT';
  end if;

  if v_topic_existed then
    select array_agg(article_id order by article_id) into v_existing_article_ids
    from news_clipping_private.topic_articles where topic_id = v_existing.id;
    select array_agg(evidence_id order by evidence_id) into v_existing_evidence_ids
    from news_clipping_private.topic_evidence where topic_id = v_existing.id;
    if v_existing.run_id is distinct from p_run_id
       or v_existing.run_date is distinct from p_run_date
       or v_existing.title is distinct from p_topic_title
       or v_existing.candidate_payload is distinct from p_candidate
       or v_existing_article_ids is distinct from v_stored_article_ids
       or v_existing_evidence_ids is distinct from v_stored_evidence_ids then
      raise exception using errcode = 'P0001', message = 'TOPIC_IDENTITY_CONFLICT';
    end if;
  else
    insert into news_clipping_private.topics(
      id, run_id, run_date, title, score, independence, evidence_policy,
      selection_reason, selected, candidate_payload, created_at
    ) values (
      p_candidate ->> 'topicId', p_run_id, p_run_date, p_topic_title,
      p_candidate -> 'score', p_candidate -> 'independence',
      p_candidate ->> 'evidencePolicy', p_candidate ->> 'selectionReason',
      true, p_candidate, v_now
    ) returning * into v_existing;
    insert into news_clipping_private.topic_articles(topic_id, article_id)
    select v_existing.id, value from unnest(v_stored_article_ids) value;
    insert into news_clipping_private.topic_evidence(topic_id, evidence_id, is_new_fact)
    select v_existing.id, value, value = any(v_new_fact_evidence_ids)
    from unnest(v_stored_evidence_ids) value;
    v_created := true;
  end if;

  if v_artifact_existed then
    if v_existing_artifact.kind is distinct from 'topic_selection'
       or v_existing_artifact.output_reference is distinct from p_artifact_output_reference
       or v_existing_artifact.payload_fingerprint is distinct from p_artifact_payload_fingerprint
       or v_existing_artifact.configuration_fingerprint is distinct from p_artifact_configuration_fingerprint
       or v_existing_artifact.parent_output_references is distinct from array[p_collect_output_reference]
       or v_existing_artifact.payload is distinct from p_artifact_payload then
      raise exception using errcode = 'P0001', message = 'OUTPUT_CONFLICT';
    end if;
  else
    insert into news_clipping_private.pipeline_artifacts(
      run_id, stage, kind, output_reference, payload_fingerprint,
      configuration_fingerprint, parent_output_references, payload
    ) values (
      p_run_id, 'score', 'topic_selection', p_artifact_output_reference,
      p_artifact_payload_fingerprint, p_artifact_configuration_fingerprint,
      array[p_collect_output_reference], p_artifact_payload
    ) returning * into v_inserted_artifact;
    v_existing_artifact := v_inserted_artifact;
  end if;

  return jsonb_build_object(
    'created', v_created,
    'topicId', v_existing.id,
    'topicTitle', v_existing.title,
    'articleIds', to_jsonb(v_stored_article_ids),
    'evidenceIds', to_jsonb(v_stored_evidence_ids),
    'artifactOutputReference', v_existing_artifact.output_reference
  );
exception
  when unique_violation then
    raise exception using errcode = 'P0001', message = 'TOPIC_IDENTITY_CONFLICT';
  when invalid_text_representation or numeric_value_out_of_range
    or check_violation or not_null_violation or foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_PAYLOAD';
end;
$$;

revoke select, insert, update on news_clipping_private.sources from service_role;
revoke select, insert, update on news_clipping_private.articles from service_role;
revoke select, insert on news_clipping_private.evidence_items from service_role;
revoke select, insert on news_clipping_private.topics from service_role;
revoke select, insert on news_clipping_private.topic_articles from service_role;
revoke select, insert on news_clipping_private.topic_evidence from service_role;

revoke all on function public.persist_collected_content(date, text, text, bigint, integer, text, jsonb, jsonb, jsonb, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.persist_selected_topic(date, text, text, bigint, integer, text, text, jsonb, jsonb, jsonb, text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.persist_empty_topic_selection(date, text, text, bigint, integer, text, text, text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.persist_collected_content(date, text, text, bigint, integer, text, jsonb, jsonb, jsonb, text, text, text, jsonb)
  to service_role;
grant execute on function public.persist_selected_topic(date, text, text, bigint, integer, text, text, jsonb, jsonb, jsonb, text, text, text, text, jsonb)
  to service_role;
grant execute on function public.persist_empty_topic_selection(date, text, text, bigint, integer, text, text, text, text, text, jsonb)
  to service_role;

comment on function public.persist_collected_content(date, text, text, bigint, integer, text, jsonb, jsonb, jsonb, text, text, text, jsonb) is
  'Server-only collect transaction. Validates the daily lease with DB time, persists source/article/evidence plus collect artifact atomically, and fails closed rather than silently remapping identity collisions.';
comment on function public.persist_selected_topic(date, text, text, bigint, integer, text, text, jsonb, jsonb, jsonb, text, text, text, text, jsonb) is
  'Server-only selected-topic put-once transaction. Persists the selected topic, exact relations and score artifact atomically, bound to the exact collect parent reference.';
comment on function public.persist_empty_topic_selection(date, text, text, bigint, integer, text, text, text, text, text, jsonb) is
  'Server-only empty topic-selection transaction. Requires zero topic rows and stores the exact outcome-none score artifact bound to the collect parent.';

commit;
