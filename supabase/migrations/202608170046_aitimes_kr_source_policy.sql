-- Register 인공지능신문(aitimes-kr) in a separate forward migration after
-- 045 was already applied. Without a matching row here,
-- reserve_source_collection_attempt raises SOURCE_POLICY_MISMATCH and the
-- daily collect stage cannot use this source at all.

begin;

insert into news_clipping_private.source_collection_policies (
  source_id,
  min_interval_ms
) values
  ('aitimes-kr', 86400000)
on conflict (source_id) do update
set min_interval_ms = excluded.min_interval_ms;

commit;
