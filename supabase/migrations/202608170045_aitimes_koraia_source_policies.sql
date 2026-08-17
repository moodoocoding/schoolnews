-- Register the two new sources added alongside the naver-summary reliability
-- fix (M22-COLLECTOR-RELIABILITY-009): AI타임스 official RSS and the
-- 한국인공지능협회 discovery API. Without a matching row here,
-- reserve_source_collection_attempt raises SOURCE_POLICY_MISMATCH and the
-- daily collect stage cannot use either source at all.

begin;

insert into news_clipping_private.source_collection_policies (
  source_id,
  min_interval_ms
) values
  ('aitimes-com', 86400000),
  ('koraia-ai-news', 86400000)
on conflict (source_id) do update
set min_interval_ms = excluded.min_interval_ms;

commit;
