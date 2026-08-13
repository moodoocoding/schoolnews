-- Preserve the public August 1-13 cards exactly as they existed before the
-- next editorial pass. This is an append-only public snapshot, independent of
-- the mutable current projection in public.published_posts.

begin;

create table public.published_post_archive (
  archive_key text not null check (archive_key ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  original_post_id text not null,
  slug text not null,
  status text not null default 'published' check (status = 'published'),
  publication_date_kst date not null,
  published_at timestamptz not null,
  modified_at timestamptz not null check (modified_at >= published_at),
  archived_at timestamptz not null default statement_timestamp(),
  title text not null,
  summary text not null,
  visual jsonb not null check (jsonb_typeof(visual) = 'object'),
  one_line_summary jsonb not null check (jsonb_typeof(one_line_summary) = 'object'),
  body jsonb not null check (
    jsonb_typeof(body) = 'array' and jsonb_array_length(body) between 3 and 5
  ),
  questions jsonb not null check (
    jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 2
  ),
  sources jsonb not null check (
    jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) >= 1
  ),
  primary key (archive_key, original_post_id),
  unique (archive_key, slug),
  unique (archive_key, publication_date_kst),
  constraint published_post_archive_kst_date check (
    publication_date_kst = (published_at at time zone 'Asia/Seoul')::date
  ),
  constraint published_post_archive_nested_contract check (
    news_clipping_private.is_valid_published_post(
      jsonb_build_object(
        'title', title,
        'summary', summary,
        'visual', visual,
        'oneLineSummary', one_line_summary,
        'body', body,
        'questions', questions,
        'sources', sources
      )
    ) is true
  )
);

insert into public.published_post_archive (
  archive_key,
  original_post_id,
  slug,
  status,
  publication_date_kst,
  published_at,
  modified_at,
  title,
  summary,
  visual,
  one_line_summary,
  body,
  questions,
  sources
)
select
  'august-2026-original',
  id,
  slug,
  status,
  publication_date_kst,
  published_at,
  modified_at,
  title,
  summary,
  visual,
  one_line_summary,
  body,
  questions,
  sources
from public.published_posts
where publication_date_kst between date '2026-08-01' and date '2026-08-13'
order by publication_date_kst;

create index published_post_archive_list
  on public.published_post_archive(archive_key, published_at desc, original_post_id desc);

create trigger published_post_archive_is_immutable
before update or delete on public.published_post_archive
for each row execute function news_clipping_private.reject_immutable_row_mutation();

alter table public.published_post_archive enable row level security;
alter table public.published_post_archive force row level security;

create policy published_post_archive_read_only
  on public.published_post_archive for select
  to anon, authenticated
  using (status = 'published');

revoke all on public.published_post_archive
  from public, anon, authenticated, service_role;
grant select on public.published_post_archive
  to anon, authenticated, service_role;

commit;
