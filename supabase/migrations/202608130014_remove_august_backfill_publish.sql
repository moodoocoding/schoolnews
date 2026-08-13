-- Remove the one-time August archive publication boundary after the approved
-- 2026-08-01..12 backfill has been verified. Published rows and the normal
-- current-day publish_post function are intentionally left untouched.
begin;

drop function if exists public.publish_backfill_post(
  date,
  text,
  text,
  bigint,
  integer,
  text,
  text,
  text,
  jsonb
);

commit;
