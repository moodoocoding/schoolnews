-- Register the reviewed Naver News metadata publisher adapters in the
-- server-authoritative daily source-attempt policy table.

begin;

insert into news_clipping_private.source_collection_policies (
  source_id,
  min_interval_ms
) values
  ('naver-news-donga', 86400000),
  ('naver-news-ohmynews', 86400000),
  ('naver-news-ebs-news', 86400000),
  ('naver-news-yonhap', 86400000),
  ('naver-news-hangyo', 86400000),
  ('naver-news-etnews', 86400000),
  ('naver-news-zdnet-korea', 86400000),
  ('naver-news-bloter', 86400000),
  ('naver-news-hani', 86400000),
  ('naver-news-khan', 86400000),
  ('naver-news-seoul-news', 86400000),
  ('naver-news-newsis', 86400000)
on conflict (source_id) do update
set min_interval_ms = excluded.min_interval_ms;

commit;
