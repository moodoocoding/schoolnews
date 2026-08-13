-- One-time, service-role-only domestic-source correction for 2026-08-01.
begin;

create or replace function public.revise_august_first_domestic_editorial(
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
  v_source_one_id constant text := 'aug01-evidence-hangyo-20260730';
  v_source_two_id constant text := 'aug01-evidence-news1-20260730';
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
  if exists (select 1 from news_clipping_private.post_revisions where id = p_new_revision_id) then
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
  if jsonb_array_length(p_post -> 'body') < 3 or v_body_length not between 600 and 1000 then
    raise exception using errcode = 'P0001', message = 'INVALID_CONTENT_LENGTH';
  end if;
  if (select count(*) from jsonb_array_elements(p_post -> 'sources')) <> 2
     or not exists (
       select 1 from jsonb_array_elements(p_post -> 'sources') source(value)
       where source.value ->> 'id' = v_source_one_id
         and source.value ->> 'publishedDate' = '2026-07-30'
         and source.value ->> 'originalUrl' = 'https://www.hangyo.com/news/article.html?no=108663'
     )
     or not exists (
       select 1 from jsonb_array_elements(p_post -> 'sources') source(value)
       where source.value ->> 'id' = v_source_two_id
         and source.value ->> 'publishedDate' = '2026-07-30'
         and source.value ->> 'originalUrl' = 'https://www.news1.kr/society/education/6243467'
     ) then
    raise exception using errcode = 'P0001', message = 'EDITORIAL_SOURCE_DATE_MISMATCH';
  end if;

  insert into news_clipping_private.sources(
    id, name, publisher_group_id, provenance_group_key, publisher_type,
    collection_type, canonical_base_url, terms_reviewed_at, enabled,
    registry_payload, created_at, updated_at
  ) values
  (
    'aug01-source-hangyo', '한국교육신문', 'korean-education-newspaper',
    'hangyo-original-reporting', 'news', 'html', 'https://www.hangyo.com/',
    v_now, false, jsonb_build_object('sourceId', 'aug01-source-hangyo', 'sourceRole', 'independent', 'sourceType', 'news', 'authority', 'none'), v_now, v_now
  ),
  (
    'aug01-source-news1', '뉴스1', 'news1-korea',
    'news1-original-reporting', 'news', 'html', 'https://www.news1.kr/',
    v_now, false, jsonb_build_object('sourceId', 'aug01-source-news1', 'sourceRole', 'independent', 'sourceType', 'news', 'authority', 'none'), v_now, v_now
  );

  insert into news_clipping_private.articles(
    id, source_id, external_id, original_url, canonical_url,
    canonical_url_hash, title, normalized_title, excerpt, author, publisher,
    publisher_group_id, provenance_group_key, published_at,
    published_at_precision, discovered_at, content_fingerprint,
    canonicalization_version, fingerprint_version, origin_type, collected_at
  ) values
  (
    'aug01-article-hangyo-20260730', 'aug01-source-hangyo', 'hangyo-108663',
    'https://www.hangyo.com/news/article.html?no=108663',
    'https://www.hangyo.com/news/article.html?no=108663',
    'a18cd6be093b518e6cf342e9d67783ca5dbaa402a4d833150c6cf40772aca3fc',
    'KERIS, AI 활용 교육 콘퍼런스 개최', 'KERIS, AI 활용 교육 콘퍼런스 개최',
    '교육부와 KERIS가 전국 교원을 대상으로 학교 AI 활용 수업 사례와 정책을 공유하는 콘퍼런스를 연다는 국내 교육 보도입니다.',
    '백승호', '한국교육신문', 'korean-education-newspaper',
    'hangyo-original-reporting', '2026-07-30T18:07:32+09:00', 'instant', v_now,
    'f74ce45047f7ccfdd0b236a122df9f1e4dad5bf54800baa3de2141f477a59df4',
    'manual-editorial-v1', 'manual-editorial-v1', 'original_reporting', v_now
  ),
  (
    'aug01-article-news1-20260730', 'aug01-source-news1', 'news1-6243467',
    'https://www.news1.kr/society/education/6243467',
    'https://www.news1.kr/society/education/6243467',
    '4207866f085bb4ad9d3b513d9eb0b3864ca5603db9e549f1ba763da047633821',
    '서울교육청, 대한민국 정보교육상 수상 교사 3명 배출…전국 최다',
    '서울교육청, 대한민국 정보교육상 수상 교사 3명 배출 전국 최다',
    '서울 지역 교사들의 피지컬 AI, 실제 데이터 프로젝트, 맞춤형 정보교육과 생성형 AI 윤리 수업 사례를 소개한 국내 보도입니다.',
    '조수빈', '뉴스1', 'news1-korea', 'news1-original-reporting',
    '2026-07-30T12:00:00+09:00', 'instant', v_now,
    '8af56945448dc52e3d8459ab04c24710586ebd776c964a914ff0cea6a0b56fd4',
    'manual-editorial-v1', 'manual-editorial-v1', 'original_reporting', v_now
  );

  insert into news_clipping_private.evidence_items(
    id, article_id, source_id, passage_id, passage_hash, publisher_group_id,
    provenance_group_key, source_role, source_type, authority, source_name,
    title, url, published_at, published_at_precision, passage, locator, created_at
  ) values
  (
    v_source_one_id, 'aug01-article-hangyo-20260730', 'aug01-source-hangyo',
    'aug01-passage-hangyo-20260730', '72a1333751b5163dc28988291bc32d6a5a7a5ca0196ff6470630de62179f57d7',
    'korean-education-newspaper', 'hangyo-original-reporting', 'independent', 'news', 'none',
    '한국교육신문', 'KERIS, AI 활용 교육 콘퍼런스 개최',
    'https://www.hangyo.com/news/article.html?no=108663',
    '2026-07-30T18:07:32+09:00', 'instant',
    '교육부와 KERIS가 전국 교원을 대상으로 학교 현장의 AI 활용 수업 사례와 최신 교육정책을 공유하고 에듀테크 체험과 전문가 논의를 진행하는 콘퍼런스를 마련했다.',
    '2026-07-30 기사 요약', v_now
  ),
  (
    v_source_two_id, 'aug01-article-news1-20260730', 'aug01-source-news1',
    'aug01-passage-news1-20260730', '096c55a3cad2e676b20b3f0843c02fd0e9f52f3809de66c7698413031ca9a092',
    'news1-korea', 'news1-original-reporting', 'independent', 'news', 'none',
    '뉴스1', '서울교육청, 대한민국 정보교육상 수상 교사 3명 배출…전국 최다',
    'https://www.news1.kr/society/education/6243467',
    '2026-07-30T12:00:00+09:00', 'instant',
    '수상 교사들은 피지컬 AI와 실제 데이터 프로젝트, 학생 수준별 정보교육, 디지털 수업자료와 생성형 AI 윤리 수업을 운영하고 사례집과 교원 연수로 성과를 공유할 예정이다.',
    '2026-07-30 기사 요약', v_now
  );

  insert into news_clipping_private.topic_articles(topic_id, article_id) values
    (v_post.topic_id, 'aug01-article-hangyo-20260730'),
    (v_post.topic_id, 'aug01-article-news1-20260730');
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
    (v_post.id, v_source_one_id, 'aug01-article-hangyo-20260730', 'aug01-source-hangyo', 0),
    (v_post.id, v_source_two_id, 'aug01-article-news1-20260730', 'aug01-source-news1', 1);

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

revoke all on function public.revise_august_first_domestic_editorial(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.revise_august_first_domestic_editorial(text, text, text, jsonb)
  to service_role;

comment on function public.revise_august_first_domestic_editorial(text, text, text, jsonb) is
  'One-time 2026-08-01 revision using exactly two domestic 2026-07-30 education reports and a 600-1000 character body.';

commit;
