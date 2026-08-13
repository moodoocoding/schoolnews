-- Atomically reserve one source collection attempt using PostgreSQL server time.
-- A reservation is consumed before the network request, including failed requests.

begin;

create table if not exists news_clipping_private.source_collection_policies (
  source_id text primary key,
  min_interval_ms bigint not null check (min_interval_ms between 60000 and 604800000)
);

insert into news_clipping_private.source_collection_policies (
  source_id,
  min_interval_ms
) values ('msit-press-release', 86400000)
on conflict (source_id) do update
set min_interval_ms = excluded.min_interval_ms;

create table if not exists news_clipping_private.source_collection_attempts (
  source_id text primary key,
  last_attempt_at timestamptz not null,
  constraint source_collection_attempts_source_id_format
    check (
      char_length(source_id) between 1 and 128
      and source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
);

alter table news_clipping_private.source_collection_attempts enable row level security;
alter table news_clipping_private.source_collection_attempts force row level security;
alter table news_clipping_private.source_collection_policies enable row level security;
alter table news_clipping_private.source_collection_policies force row level security;

revoke all on news_clipping_private.source_collection_attempts
  from public, anon, authenticated, service_role;
revoke all on news_clipping_private.source_collection_policies
  from public, anon, authenticated, service_role;

create or replace function public.reserve_source_collection_attempt(
  p_source_id text,
  p_min_interval_ms bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_previous_attempt_at timestamptz;
  v_now timestamptz;
  v_next_allowed_at timestamptz;
  v_policy_interval_ms bigint;
begin
  if p_source_id is null
    or char_length(p_source_id) not between 1 and 128
    or p_source_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  then
    raise exception using errcode = '22023', message = 'INVALID_SOURCE_ID';
  end if;

  if p_min_interval_ms is null
    or p_min_interval_ms < 60000
    or p_min_interval_ms > 604800000
  then
    raise exception using errcode = '22023', message = 'INVALID_MIN_INTERVAL';
  end if;

  select min_interval_ms
  into v_policy_interval_ms
  from news_clipping_private.source_collection_policies
  where source_id = p_source_id;

  if v_policy_interval_ms is null or p_min_interval_ms <> v_policy_interval_ms then
    raise exception using errcode = '22023', message = 'SOURCE_POLICY_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-source-attempt:' || p_source_id, 0)
  );

  select last_attempt_at
  into v_previous_attempt_at
  from news_clipping_private.source_collection_attempts
  where source_id = p_source_id
  for update;

  v_now := clock_timestamp();

  if v_previous_attempt_at is not null then
    v_next_allowed_at := v_previous_attempt_at
      + (v_policy_interval_ms * interval '1 millisecond');

    if v_now < v_next_allowed_at then
      return jsonb_build_object(
        'status', 'too_soon',
        'code', 'TOO_SOON',
        'sourceId', p_source_id,
        'lastAttemptAt', v_previous_attempt_at,
        'nextAllowedAt', v_next_allowed_at
      );
    end if;
  end if;

  insert into news_clipping_private.source_collection_attempts (
    source_id,
    last_attempt_at
  ) values (
    p_source_id,
    v_now
  )
  on conflict (source_id) do update
  set last_attempt_at = excluded.last_attempt_at;

  return jsonb_build_object(
    'status', 'allowed',
    'sourceId', p_source_id,
    'lastAttemptAt', v_now,
    'nextAllowedAt', v_now + (v_policy_interval_ms * interval '1 millisecond')
  );
end;
$$;

revoke all on function public.reserve_source_collection_attempt(text, bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_source_collection_attempt(text, bigint)
  to service_role;

comment on function public.reserve_source_collection_attempt(text, bigint) is
  'Server-only source attempt reservation. Uses server clock and a source-scoped advisory lock. Failed network calls still consume the interval.';

commit;
