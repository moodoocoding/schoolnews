-- Server-only rolling candidate input and latest publication date. Daily
-- collection remains immutable; selection may compare the prior seven
-- completed KST calendar days without copying old rows into today's collect.

begin;

create or replace function public.get_publication_history(
  p_limit integer default 365
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 365 then
    raise exception using errcode = '22023', message = 'INVALID_PUBLICATION_HISTORY_LIMIT';
  end if;
  with recent_posts as materialized (
    select p.id, p.title, p.publication_date_kst
    from news_clipping_private.posts p
    join public.published_posts published on published.id = p.id
    where p.status = 'published' and published.status = 'published' and p.title is not null
    order by p.publication_date_kst desc, p.id desc
    limit p_limit
  ), recent_titles as (
    select coalesce(jsonb_agg(title order by publication_date_kst desc, id desc), '[]'::jsonb) value
    from recent_posts
  ), recent_fingerprints as (
    select coalesce(jsonb_agg(content_fingerprint order by content_fingerprint), '[]'::jsonb) value
    from (
      select distinct article.content_fingerprint
      from recent_posts post
      join news_clipping_private.post_sources source on source.post_id = post.id
      join news_clipping_private.articles article on article.id = source.article_id
      order by article.content_fingerprint
      limit p_limit
    ) fingerprints
  )
  select jsonb_build_object(
    'titles', recent_titles.value,
    'contentFingerprints', recent_fingerprints.value,
    'latestPublicationDateKst', (select to_char(max(publication_date_kst), 'YYYY-MM-DD') from recent_posts)
  ) into v_result
  from recent_titles cross join recent_fingerprints;
  return v_result;
end;
$$;

revoke all on function public.get_publication_history(integer)
  from public, anon, authenticated;
grant execute on function public.get_publication_history(integer) to service_role;

create or replace function public.get_rolling_editorial_materials(
  p_run_date date,
  p_window_days integer default 7
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_result jsonb;
begin
  if p_run_date is null or p_window_days is null or p_window_days not between 1 and 7 then
    raise exception using errcode = '22023', message = 'INVALID_EDITORIAL_WINDOW';
  end if;

  with window_articles as materialized (
    select article.*
    from news_clipping_private.articles article
    join news_clipping_private.sources source on source.id = article.source_id
    where (article.published_at at time zone 'Asia/Seoul')::date >= p_run_date - p_window_days
      and (article.published_at at time zone 'Asia/Seoul')::date < p_run_date
      and source.enabled
      and source.registry_payload ->> 'accessStatus' = 'allowed'
      and source.registry_payload ->> 'contentUse' = 'evidence'
  ), article_payloads as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'sourceId', article.source_id,
          'externalId', article.external_id,
          'originalUrl', article.original_url,
          'hostedArticleUrl', null,
          'title', article.title,
          'excerpt', article.excerpt,
          'author', article.author,
          'publisher', article.publisher,
          'publishedAt', article.published_at,
          'publishedAtPrecision', article.published_at_precision,
          'discoveredAt', article.discovered_at,
          'articleId', article.id,
          'publisherGroupId', article.publisher_group_id,
          'provenanceGroupKey', article.provenance_group_key,
          'canonicalUrl', article.canonical_url,
          'canonicalUrlHash', article.canonical_url_hash,
          'normalizedTitle', article.normalized_title,
          'contentFingerprint', article.content_fingerprint,
          'canonicalizationVersion', article.canonicalization_version,
          'fingerprintVersion', article.fingerprint_version,
          'originType', article.origin_type
        ) order by article.published_at desc, article.id
      ), '[]'::jsonb
    ) as value
    from window_articles article
  ), evidence_payloads as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'evidenceId', evidence.id,
          'articleId', evidence.article_id,
          'passageId', evidence.passage_id,
          'passageHash', evidence.passage_hash,
          'sourceId', evidence.source_id,
          'publisherGroupId', evidence.publisher_group_id,
          'provenanceGroupKey', evidence.provenance_group_key,
          'sourceRole', evidence.source_role,
          'sourceType', evidence.source_type,
          'authority', evidence.authority,
          'sourceName', evidence.source_name,
          'title', evidence.title,
          'url', evidence.url,
          'publishedAt', evidence.published_at,
          'publishedAtPrecision', evidence.published_at_precision,
          'passage', evidence.passage,
          'locator', evidence.locator
        ) order by evidence.published_at desc, evidence.id
      ), '[]'::jsonb
    ) as value
    from news_clipping_private.evidence_items evidence
    join window_articles article on article.id = evidence.article_id
  )
  select jsonb_build_object(
    'articles', article_payloads.value,
    'evidenceItems', evidence_payloads.value
  ) into v_result
  from article_payloads cross join evidence_payloads;

  return v_result;
end;
$$;

revoke all on function public.get_rolling_editorial_materials(date, integer)
  from public, anon, authenticated;
grant execute on function public.get_rolling_editorial_materials(date, integer)
  to service_role;

comment on function public.get_rolling_editorial_materials(date, integer) is
  'Server-only exact article and evidence inputs for the prior one-to-seven completed KST days.';

commit;
