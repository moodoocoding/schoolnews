-- One-time AI/digital-education thought-piece refinement for 2026-08-01.
begin;

create or replace function public.revise_august_first_thought_piece(
  p_expected_post_id text,
  p_expected_active_revision_id text,
  p_new_revision_id text,
  p_post jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_post news_clipping_private.posts%rowtype;
  v_detail jsonb;
  v_body_length integer;
begin
  if p_expected_post_id is null
     or p_expected_active_revision_id is null
     or p_new_revision_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:2026-08-01', 0));
  select * into v_post from news_clipping_private.posts
  where publication_date_kst = date '2026-08-01' for update;
  if not found
     or v_post.id <> p_expected_post_id
     or v_post.status <> 'published'
     or v_post.active_revision_id <> p_expected_active_revision_id
     or exists (select 1 from news_clipping_private.post_revisions where id = p_new_revision_id) then
    raise exception using errcode = 'P0001', message = 'EDITORIAL_REVISION_CONFLICT';
  end if;

  if p_post ->> 'id' is distinct from v_post.id
     or p_post ->> 'slug' is distinct from v_post.slug
     or p_post ->> 'publicationDateKst' is distinct from '2026-08-01'
     or news_clipping_private.is_valid_published_post(p_post) is distinct from true then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  select coalesce(sum(char_length(claim ->> 'text')), 0) into v_body_length
  from jsonb_array_elements(p_post -> 'body') paragraph(value)
  cross join lateral jsonb_array_elements(paragraph.value -> 'claims') body_claim(claim);
  if jsonb_array_length(p_post -> 'body') <> 3 or v_body_length not between 600 and 700 then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_LENGTH';
  end if;
  if (select count(*) from jsonb_array_elements(p_post -> 'sources')) <> 2
     or not exists (
       select 1 from jsonb_array_elements(p_post -> 'sources') source(value)
       where source.value ->> 'id' = 'aug01-evidence-hangyo-20260730'
         and source.value ->> 'publishedDate' = '2026-07-30'
         and source.value ->> 'originalUrl' = 'https://www.hangyo.com/news/article.html?no=108663'
     )
     or not exists (
       select 1 from jsonb_array_elements(p_post -> 'sources') source(value)
       where source.value ->> 'id' = 'aug01-evidence-news1-20260730'
         and source.value ->> 'publishedDate' = '2026-07-30'
         and source.value ->> 'originalUrl' = 'https://www.news1.kr/society/education/6243467'
     ) then
    raise exception using errcode = 'P0001', message = 'EDITORIAL_SOURCE_DATE_MISMATCH';
  end if;

  v_detail := p_post || jsonb_build_object(
    'publishedAt', news_clipping_private.iso_json(v_post.published_at),
    'modifiedAt', news_clipping_private.iso_json(v_now)
  );
  insert into news_clipping_private.post_revisions(id, post_id, detail, created_at)
  values (p_new_revision_id, v_post.id, v_detail, v_now);
  update news_clipping_private.posts set
    active_revision_id = p_new_revision_id, modified_at = v_now,
    title = v_detail ->> 'title', summary = v_detail ->> 'summary', visual = v_detail -> 'visual'
  where id = v_post.id;
  update public.published_posts set
    modified_at = v_now, title = v_detail ->> 'title', summary = v_detail ->> 'summary',
    visual = v_detail -> 'visual', one_line_summary = v_detail -> 'oneLineSummary',
    body = v_detail -> 'body', questions = v_detail -> 'questions', sources = v_detail -> 'sources'
  where id = v_post.id;
  return v_detail;
end;
$$;

revoke all on function public.revise_august_first_thought_piece(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.revise_august_first_thought_piece(text, text, text, jsonb)
  to service_role;

comment on function public.revise_august_first_thought_piece(text, text, text, jsonb) is
  'One-time 2026-08-01 AI/digital-education thought piece: exactly three paragraphs and 600-700 body characters.';

commit;
