-- Register the v4 Naver Search API summary adapters without mutating the
-- previous discovery-only source identities. The API summary is a bounded
-- evidence document; it is not an article full-text crawl.

begin;

insert into news_clipping_private.source_collection_policies (
  source_id,
  min_interval_ms
) values
  ('naver-summary-donga', 86400000),
  ('naver-summary-ohmynews', 86400000),
  ('naver-summary-ebs-news', 86400000),
  ('naver-summary-yonhap', 86400000),
  ('naver-summary-hangyo', 86400000),
  ('naver-summary-etnews', 86400000),
  ('naver-summary-zdnet-korea', 86400000),
  ('naver-summary-bloter', 86400000),
  ('naver-summary-hani', 86400000),
  ('naver-summary-khan', 86400000),
  ('naver-summary-seoul-news', 86400000),
  ('naver-summary-chosun', 86400000),
  ('naver-summary-newsis', 86400000)
on conflict (source_id) do update
set min_interval_ms = excluded.min_interval_ms;

commit;
