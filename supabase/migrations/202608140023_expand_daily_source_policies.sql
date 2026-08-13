-- Register every newly reviewed RSS route in the server-authoritative daily
-- source-attempt policy table. Discovery-only feeds are still reserved here
-- because a failed metadata request must consume the same daily interval.

begin;

insert into news_clipping_private.source_collection_policies (
  source_id,
  min_interval_ms
) values
  ('kedi-press-release', 86400000),
  ('kisa-press-release', 86400000),
  ('mohw-press-release', 86400000),
  ('krcert-report-guide', 86400000),
  ('kocca-research', 86400000),
  ('newsis-tech-rss', 86400000)
on conflict (source_id) do update
set min_interval_ms = excluded.min_interval_ms;

commit;
