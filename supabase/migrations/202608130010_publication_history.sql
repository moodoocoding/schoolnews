-- Bounded, server-only publication history for deterministic novelty checks.

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
    raise exception using
      errcode = '22023',
      message = 'INVALID_PUBLICATION_HISTORY_LIMIT';
  end if;

  with recent_posts as materialized (
    select p.id, p.title, p.publication_date_kst
    from news_clipping_private.posts p
    join public.published_posts published on published.id = p.id
    where p.status = 'published'
      and published.status = 'published'
      and p.title is not null
    order by p.publication_date_kst desc, p.id desc
    limit p_limit
  ),
  recent_titles as (
    select coalesce(
      jsonb_agg(title order by publication_date_kst desc, id desc),
      '[]'::jsonb
    ) as value
    from recent_posts
  ),
  recent_fingerprints as (
    select coalesce(jsonb_agg(content_fingerprint order by content_fingerprint), '[]'::jsonb) as value
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
      'contentFingerprints', recent_fingerprints.value
    )
  into v_result
  from recent_titles cross join recent_fingerprints
  ;
  return v_result;
end;
$$;

revoke all on function public.get_publication_history(integer)
  from public, anon, authenticated;
grant execute on function public.get_publication_history(integer)
  to service_role;

comment on function public.get_publication_history(integer) is
  'Server-only bounded published titles and related article fingerprints for novelty checks.';

commit;
