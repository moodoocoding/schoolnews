-- Register Chosun as a Naver metadata discovery-only publisher adapter.

begin;

insert into news_clipping_private.source_collection_policies (
  source_id,
  min_interval_ms
) values ('naver-news-chosun', 86400000)
on conflict (source_id) do update
set min_interval_ms = excluded.min_interval_ms;

commit;
