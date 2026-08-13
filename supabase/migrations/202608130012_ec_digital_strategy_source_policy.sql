-- Add the reviewed European Commission digital-strategy RSS to the
-- server-authoritative collection interval registry.

begin;

insert into news_clipping_private.source_collection_policies (
  source_id,
  min_interval_ms
) values ('ec-digital-strategy', 86400000)
on conflict (source_id) do update
set min_interval_ms = excluded.min_interval_ms;

commit;
