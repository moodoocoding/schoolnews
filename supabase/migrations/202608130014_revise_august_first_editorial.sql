-- One-time, service-role-only editorial correction for the 2026-08-01 post.
-- It preserves the post identity and original revision, adds a new immutable
-- revision, and replaces the public projection atomically with July 30 sources.
begin;

create or replace function public.revise_august_first_editorial(
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
  v_source_one_id constant text := 'aug01-evidence-govtech-20260730';
  v_source_two_id constant text := 'aug01-evidence-monterey-20260730';
begin
  if p_expected_post_id is null
     or p_expected_active_revision_id is null
     or p_new_revision_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:2026-08-01', 0));
  select * into v_post
  from news_clipping_private.posts
  where publication_date_kst = date '2026-08-01'
  for update;

  if not found
     or v_post.id <> p_expected_post_id
     or v_post.status <> 'published'
     or v_post.active_revision_id <> p_expected_active_revision_id then
    raise exception using errcode = 'P0001', message = 'EDITORIAL_REVISION_CONFLICT';
  end if;
  if exists (
    select 1 from news_clipping_private.post_revisions where id = p_new_revision_id
  ) then
    raise exception using errcode = 'P0001', message = 'EDITORIAL_REVISION_CONFLICT';
  end if;
  if p_post ->> 'id' is distinct from v_post.id
     or p_post ->> 'slug' is distinct from v_post.slug
     or p_post ->> 'publicationDateKst' is distinct from '2026-08-01'
     or char_length(btrim(p_post ->> 'title')) not between 1 and 36
     or char_length(btrim(p_post ->> 'summary')) not between 1 and 100
     or news_clipping_private.is_valid_published_post(p_post) is distinct from true then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;

  select coalesce(sum(char_length(claim ->> 'text')), 0)
  into v_body_length
  from jsonb_array_elements(p_post -> 'body') as paragraph(value)
  cross join lateral jsonb_array_elements(paragraph.value -> 'claims') as body_claim(claim);
  if v_body_length not between 600 and 1000 then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_LENGTH';
  end if;
  if (select count(*) from jsonb_array_elements(p_post -> 'sources')) <> 2
     or not exists (
       select 1 from jsonb_array_elements(p_post -> 'sources') source(value)
       where source.value ->> 'id' = v_source_one_id
         and source.value ->> 'publishedDate' = '2026-07-30'
         and source.value ->> 'originalUrl' = 'https://www.govtech.com/education/k-12/school-districts-rethink-relationship-between-curriculum-it'
     )
     or not exists (
       select 1 from jsonb_array_elements(p_post -> 'sources') source(value)
       where source.value ->> 'id' = v_source_two_id
         and source.value ->> 'publishedDate' = '2026-07-30'
         and source.value ->> 'originalUrl' = 'https://www.montereycountynow.com/news/local_news/monterey-county-school-districts-to-roll-out-ai-policies-for-the-upcoming-school-year/article_b4b3bc77-c854-482c-a373-f906e532ab26.html'
     ) then
    raise exception using errcode = 'P0001', message = 'EDITORIAL_SOURCE_DATE_MISMATCH';
  end if;

  insert into news_clipping_private.sources(
    id, name, publisher_group_id, provenance_group_key, publisher_type,
    collection_type, canonical_base_url, terms_reviewed_at, enabled,
    registry_payload, created_at, updated_at
  ) values
  (
    'aug01-source-govtech', 'Government Technology', 'erepublic-govtech',
    'govtech-original-reporting', 'news', 'html', 'https://www.govtech.com/',
    v_now, false, jsonb_build_object('sourceId', 'aug01-source-govtech', 'sourceRole', 'independent', 'sourceType', 'news', 'authority', 'none'), v_now, v_now
  ),
  (
    'aug01-source-monterey', 'Monterey County NOW', 'monterey-county-now',
    'monterey-original-reporting', 'news', 'html', 'https://www.montereycountynow.com/',
    v_now, false, jsonb_build_object('sourceId', 'aug01-source-monterey', 'sourceRole', 'independent', 'sourceType', 'news', 'authority', 'none'), v_now, v_now
  );

  insert into news_clipping_private.articles(
    id, source_id, external_id, original_url, canonical_url,
    canonical_url_hash, title, normalized_title, excerpt, author, publisher,
    publisher_group_id, provenance_group_key, published_at,
    published_at_precision, discovered_at, content_fingerprint,
    canonicalization_version, fingerprint_version, origin_type, collected_at
  ) values
  (
    'aug01-article-govtech-20260730', 'aug01-source-govtech', 'govtech-20260730-curriculum-first',
    'https://www.govtech.com/education/k-12/school-districts-rethink-relationship-between-curriculum-it',
    'https://www.govtech.com/education/k-12/school-districts-rethink-relationship-between-curriculum-it',
    '8bcc3524a9d5152acf7b0ecf7e57942e0a8375f4f01ceda70b3364f761a4de4a',
    'School Districts Rethink Relationship Between Curriculum, IT',
    'School Districts Rethink Relationship Between Curriculum, IT',
    '교육기술 도입은 제품이 아니라 수업의 문제와 학습 목표에서 시작해야 하며 교육과정 담당자와 기술 담당자의 협력이 필요하다는 학교 현장 보도입니다.',
    'Julia Gilban-Cohen', 'Government Technology', 'erepublic-govtech',
    'govtech-original-reporting', '2026-07-30T12:00:00Z', 'date', v_now,
    '2ae6c658187e6eaa0291f717900a456033f3a22707f382b51918de818330f78e',
    'manual-editorial-v1', 'manual-editorial-v1', 'original_reporting', v_now
  ),
  (
    'aug01-article-monterey-20260730', 'aug01-source-monterey', 'monterey-20260730-ai-policy',
    'https://www.montereycountynow.com/news/local_news/monterey-county-school-districts-to-roll-out-ai-policies-for-the-upcoming-school-year/article_b4b3bc77-c854-482c-a373-f906e532ab26.html',
    'https://www.montereycountynow.com/news/local_news/monterey-county-school-districts-to-roll-out-ai-policies-for-the-upcoming-school-year/article_b4b3bc77-c854-482c-a373-f906e532ab26.html',
    '39edb9e0a3512a10af206b75cf187e30edb9b1591aa6ecd687fddd81873ec22a',
    'Monterey County school districts to roll out AI policies for the upcoming school year',
    'Monterey County school districts to roll out AI policies for the upcoming school year',
    '학교별 AI 정책에 디지털 안전, 연령별 화면 사용, 교사의 AI 과제·채점 공개와 교직원 연수를 포함한 사례를 소개한 지역 보도입니다.',
    'Celia Jiménez', 'Monterey County NOW', 'monterey-county-now',
    'monterey-original-reporting', '2026-07-30T12:00:00Z', 'date', v_now,
    '9c1c317c4a4d7e00684939c1018358b96e3ec1b3adb7478fd7d92c56af852ec2',
    'manual-editorial-v1', 'manual-editorial-v1', 'original_reporting', v_now
  );

  insert into news_clipping_private.evidence_items(
    id, article_id, source_id, passage_id, passage_hash, publisher_group_id,
    provenance_group_key, source_role, source_type, authority, source_name,
    title, url, published_at, published_at_precision, passage, locator, created_at
  ) values
  (
    v_source_one_id, 'aug01-article-govtech-20260730', 'aug01-source-govtech',
    'aug01-passage-govtech-20260730', 'd965032c42abdde5b92b1dfe8376ccc8453d149b2a6faa9e4be7c3e06fe5396e',
    'erepublic-govtech', 'govtech-original-reporting', 'independent', 'news', 'none',
    'Government Technology', 'School Districts Rethink Relationship Between Curriculum, IT',
    'https://www.govtech.com/education/k-12/school-districts-rethink-relationship-between-curriculum-it',
    '2026-07-30T12:00:00Z', 'date',
    '학교 기술 책임자들은 교육기술 구매보다 교사가 해결하려는 학습 문제를 먼저 정하고, 교육과정과 기술 담당자가 수업 현장과 연결된 채 함께 효과를 살펴야 한다고 설명했다.',
    '2026-07-30 기사 요약', v_now
  ),
  (
    v_source_two_id, 'aug01-article-monterey-20260730', 'aug01-source-monterey',
    'aug01-passage-monterey-20260730', '81770d456e1225e9cbc3f7790663bd9633a1add3d905a419a4af0a0862806b8e',
    'monterey-county-now', 'monterey-original-reporting', 'independent', 'news', 'none',
    'Monterey County NOW', 'Monterey County school districts to roll out AI policies for the upcoming school year',
    'https://www.montereycountynow.com/news/local_news/monterey-county-school-districts-to-roll-out-ai-policies-for-the-upcoming-school-year/article_b4b3bc77-c854-482c-a373-f906e532ab26.html',
    '2026-07-30T12:00:00Z', 'date',
    '지역 교육구 사례에서는 디지털 안전, 연령별 화면 사용, 교사가 AI 과제나 채점 사용 여부를 알리는 규칙, 도구 도입 전 교직원 연수가 학교 AI 정책에 포함됐다.',
    '2026-07-30 기사 요약', v_now
  );

  insert into news_clipping_private.topic_articles(topic_id, article_id) values
    (v_post.topic_id, 'aug01-article-govtech-20260730'),
    (v_post.topic_id, 'aug01-article-monterey-20260730');
  insert into news_clipping_private.topic_evidence(topic_id, evidence_id, is_new_fact) values
    (v_post.topic_id, v_source_one_id, true),
    (v_post.topic_id, v_source_two_id, true);

  v_detail := p_post || jsonb_build_object(
    'publishedAt', news_clipping_private.iso_json(v_post.published_at),
    'modifiedAt', news_clipping_private.iso_json(v_now)
  );
  insert into news_clipping_private.post_revisions(id, post_id, detail, created_at)
  values (p_new_revision_id, v_post.id, v_detail, v_now);

  update news_clipping_private.post_sources
  set display_order = display_order + 10
  where post_id = v_post.id;
  insert into news_clipping_private.post_sources(post_id, evidence_id, article_id, source_id, display_order) values
    (v_post.id, v_source_one_id, 'aug01-article-govtech-20260730', 'aug01-source-govtech', 0),
    (v_post.id, v_source_two_id, 'aug01-article-monterey-20260730', 'aug01-source-monterey', 1);

  update news_clipping_private.posts set
    active_revision_id = p_new_revision_id,
    modified_at = v_now,
    title = v_detail ->> 'title',
    summary = v_detail ->> 'summary',
    visual = v_detail -> 'visual'
  where id = v_post.id;

  update public.published_posts set
    modified_at = v_now,
    title = v_detail ->> 'title',
    summary = v_detail ->> 'summary',
    visual = v_detail -> 'visual',
    one_line_summary = v_detail -> 'oneLineSummary',
    body = v_detail -> 'body',
    questions = v_detail -> 'questions',
    sources = v_detail -> 'sources'
  where id = v_post.id;

  return v_detail;
end;
$$;

revoke all on function public.revise_august_first_editorial(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.revise_august_first_editorial(text, text, text, jsonb)
  to service_role;

comment on function public.revise_august_first_editorial(text, text, text, jsonb) is
  'One-time 2026-08-01 editorial revision using exactly two independently reported 2026-07-30 sources and a 600-1000 character body.';

commit;
