-- M6-SUPABASE-SCHEMA-001
-- Supabase/PostgreSQL persistence for the daily AI education news service.
-- This is a forward-only migration. It intentionally contains no DROP statements.
--
-- Trust boundary:
--   * news_clipping_private contains drafts, source material, run journals and audit data.
--   * public.published_posts is a projection table containing published rows only.
--   * anon/authenticated can SELECT only that projection.
--   * service_role receives narrowly listed grants and is expected only in server code.

begin;

create schema if not exists news_clipping_private;

revoke all on schema news_clipping_private from public;
revoke all on schema news_clipping_private from anon;
revoke all on schema news_clipping_private from authenticated;

create table news_clipping_private.sources (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  publisher_group_id text not null check (publisher_group_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provenance_group_key text not null check (provenance_group_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  publisher_type text not null check (publisher_type in ('official', 'news', 'wire', 'research', 'other')),
  collection_type text not null check (collection_type in ('rss', 'api', 'html')),
  canonical_base_url text check (canonical_base_url is null or canonical_base_url ~ '^https://'),
  terms_reviewed_at timestamptz,
  enabled boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table news_clipping_private.articles (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  source_id text not null references news_clipping_private.sources(id) on delete restrict,
  external_id text check (external_id is null or char_length(external_id) between 1 and 512),
  original_url text not null check (original_url ~ '^https://'),
  canonical_url text not null check (canonical_url ~ '^https://'),
  canonical_url_hash text not null unique check (canonical_url_hash ~ '^[a-f0-9]{64}$'),
  title text not null check (char_length(btrim(title)) between 1 and 500),
  normalized_title text not null check (char_length(btrim(normalized_title)) between 1 and 500),
  excerpt text check (excerpt is null or char_length(excerpt) <= 2000),
  author text check (author is null or char_length(author) <= 300),
  publisher text not null check (char_length(btrim(publisher)) between 1 and 200),
  publisher_group_id text not null,
  provenance_group_key text not null,
  published_at timestamptz not null,
  published_at_precision text not null check (published_at_precision in ('date', 'instant')),
  discovered_at timestamptz not null,
  content_fingerprint text not null unique check (content_fingerprint ~ '^[a-f0-9]{64}$'),
  canonicalization_version text not null check (char_length(canonicalization_version) between 1 and 64),
  fingerprint_version text not null check (char_length(fingerprint_version) between 1 and 64),
  origin_type text not null check (origin_type in ('primary_document', 'original_reporting', 'wire', 'press_release_rewrite', 'unknown')),
  collected_at timestamptz not null default clock_timestamp(),
  unique (id, source_id),
  unique (source_id, external_id)
);

create table news_clipping_private.evidence_items (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  article_id text not null,
  source_id text not null,
  passage_id text not null check (passage_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  passage_hash text not null check (passage_hash ~ '^[a-f0-9]{64}$'),
  publisher_group_id text not null,
  provenance_group_key text not null,
  source_role text not null check (source_role in ('primary', 'independent', 'supporting')),
  source_type text not null check (source_type in ('primary', 'news', 'research')),
  authority text not null default 'none' check (authority in ('none', 'public_authority_direct_fact')),
  source_name text not null check (char_length(btrim(source_name)) between 1 and 200),
  title text not null check (char_length(btrim(title)) between 1 and 500),
  url text not null check (url ~ '^https://'),
  published_at timestamptz not null,
  published_at_precision text not null check (published_at_precision in ('date', 'instant')),
  passage text not null check (char_length(btrim(passage)) between 1 and 2000),
  locator text check (locator is null or char_length(locator) <= 300),
  created_at timestamptz not null default clock_timestamp(),
  constraint evidence_article_source_fk foreign key (article_id, source_id)
    references news_clipping_private.articles(id, source_id) on delete restrict,
  unique (article_id, passage_hash),
  unique (id, article_id, source_id)
);

create table news_clipping_private.daily_runs (
  run_date date primary key,
  run_id text not null unique check (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  journal jsonb not null check (jsonb_typeof(journal) = 'object'),
  journal_revision integer not null check (journal_revision >= 0),
  status text not null check (status in ('pending', 'running', 'succeeded', 'succeeded_without_publish', 'published_with_warning', 'failed', 'blocked')),
  owner_id text check (owner_id is null or owner_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  lease_token text check (lease_token is null or lease_token ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  fence bigint not null default 0 check (fence >= 0),
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  last_client_observed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique (run_date, run_id),
  constraint daily_run_journal_revision_matches check (
    journal ? 'revision'
    and (journal ->> 'revision') ~ '^[0-9]+$'
    and journal_revision = (journal ->> 'revision')::integer
  ),
  constraint daily_run_identity_matches check (
    journal #>> '{run,runId}' = run_id
    and (journal #>> '{run,runDate}')::date = run_date
    and journal #>> '{run,status}' = status
  ),
  constraint daily_run_lease_shape check (
    (owner_id is null and lease_token is null and lease_acquired_at is null and lease_expires_at is null)
    or
    (owner_id is not null and lease_token is not null and lease_acquired_at is not null and lease_expires_at > lease_acquired_at and fence >= 1)
  )
);

create table news_clipping_private.topics (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  run_id text not null references news_clipping_private.daily_runs(run_id) on delete restrict,
  run_date date not null references news_clipping_private.daily_runs(run_date) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  score jsonb not null check (jsonb_typeof(score) = 'object'),
  independence jsonb not null check (jsonb_typeof(independence) = 'object'),
  evidence_policy text not null check (evidence_policy in ('primary_plus_independent', 'two_independent_sources', 'authoritative_single_source')),
  selection_reason text not null check (char_length(btrim(selection_reason)) between 1 and 1000),
  selected boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, run_id),
  constraint topic_run_identity_fk foreign key (run_date, run_id)
    references news_clipping_private.daily_runs(run_date, run_id) on delete restrict
);

create table news_clipping_private.topic_articles (
  topic_id text not null references news_clipping_private.topics(id) on delete restrict,
  article_id text not null references news_clipping_private.articles(id) on delete restrict,
  primary key (topic_id, article_id)
);

create table news_clipping_private.topic_evidence (
  topic_id text not null references news_clipping_private.topics(id) on delete restrict,
  evidence_id text not null references news_clipping_private.evidence_items(id) on delete restrict,
  is_new_fact boolean not null default false,
  primary key (topic_id, evidence_id)
);

create unique index topics_one_selected_per_run_date
  on news_clipping_private.topics(run_date)
  where selected;

create table news_clipping_private.posts (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 120),
  publication_date_kst date not null unique,
  topic_id text not null references news_clipping_private.topics(id) on delete restrict,
  published_by_run_id text not null unique references news_clipping_private.daily_runs(run_id) on delete restrict,
  status text not null check (status in ('draft', 'validated', 'published', 'rejected', 'withheld')),
  active_revision_id text,
  published_at timestamptz,
  modified_at timestamptz not null default clock_timestamp(),
  title text,
  summary text,
  visual jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint published_post_required_projection check (
    status <> 'published'
    or (
      active_revision_id is not null
      and published_at is not null
      and title is not null
      and summary is not null
      and visual is not null
      and publication_date_kst = (published_at at time zone 'Asia/Seoul')::date
    )
  )
);

create table news_clipping_private.post_revisions (
  id text not null check (id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  post_id text not null references news_clipping_private.posts(id) on delete restrict,
  schema_version text not null default 'supabase-v1',
  detail jsonb not null check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (id),
  unique (id, post_id),
  constraint revision_post_identity_matches check (detail ->> 'id' = post_id),
  constraint revision_identity_matches check (detail ->> 'activeRevisionId' is null)
);

alter table news_clipping_private.posts
  add constraint posts_active_revision_fk
  foreign key (active_revision_id, id)
  references news_clipping_private.post_revisions(id, post_id)
  deferrable initially deferred;

create table news_clipping_private.post_sources (
  post_id text not null references news_clipping_private.posts(id) on delete restrict,
  evidence_id text not null,
  article_id text not null,
  source_id text not null,
  display_order smallint not null check (display_order >= 0),
  primary key (post_id, evidence_id),
  unique (post_id, display_order),
  constraint post_source_evidence_fk foreign key (evidence_id, article_id, source_id)
    references news_clipping_private.evidence_items(id, article_id, source_id) on delete restrict
);

create table news_clipping_private.pipeline_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references news_clipping_private.daily_runs(run_id) on delete restrict,
  stage text not null check (stage in ('collect', 'normalize', 'deduplicate', 'score', 'retrieve', 'generate', 'validate', 'publish', 'cache_refresh')),
  kind text not null check (kind in ('news_ingestion', 'topic_selection', 'post_generation', 'publication')),
  output_reference text not null unique check (char_length(output_reference) between 1 and 500),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[a-f0-9]{64}$'),
  configuration_fingerprint text not null check (configuration_fingerprint ~ '^[a-f0-9]{64}$'),
  parent_output_references text[] not null default '{}',
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (run_id, stage)
);

create table news_clipping_private.pipeline_artifact_parents (
  child_artifact_id uuid not null references news_clipping_private.pipeline_artifacts(id) on delete restrict,
  parent_artifact_id uuid not null references news_clipping_private.pipeline_artifacts(id) on delete restrict,
  primary key (child_artifact_id, parent_artifact_id),
  check (child_artifact_id <> parent_artifact_id)
);

create table news_clipping_private.model_calls (
  call_id text primary key check (call_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  run_id text not null references news_clipping_private.daily_runs(run_id) on delete restrict,
  artifact_id uuid references news_clipping_private.pipeline_artifacts(id) on delete restrict,
  attempt_number smallint not null check (attempt_number between 1 and 2),
  purpose text not null check (purpose in ('draft', 'revision', 'semantic_review')),
  provider_id text not null check (provider_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  model_id text not null check (char_length(btrim(model_id)) between 1 and 160),
  prompt_version text not null check (char_length(btrim(prompt_version)) between 1 and 64),
  started_at timestamptz not null,
  finished_at timestamptz not null check (finished_at >= started_at),
  evidence_ids text[] not null check (cardinality(evidence_ids) >= 1),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  total_tokens integer not null check (total_tokens >= input_tokens + output_tokens),
  estimated_cost_usd numeric(14,8) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  finish_reason text check (finish_reason is null or char_length(finish_reason) between 1 and 80),
  response_id text check (response_id is null or char_length(response_id) between 1 and 256),
  created_at timestamptz not null default clock_timestamp(),
  unique (run_id, purpose, attempt_number)
);

create table news_clipping_private.model_call_evidence (
  call_id text not null references news_clipping_private.model_calls(call_id) on delete restrict,
  evidence_id text not null references news_clipping_private.evidence_items(id) on delete restrict,
  primary key (call_id, evidence_id)
);

create function news_clipping_private.is_valid_published_post(p_post jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_paragraph jsonb;
  v_claim jsonb;
  v_question jsonb;
  v_source jsonb;
  v_source_id jsonb;
begin
  if jsonb_typeof(p_post) <> 'object'
     or coalesce(char_length(btrim(p_post ->> 'title')), 0) not between 1 and 500
     or coalesce(char_length(btrim(p_post ->> 'summary')), 0) not between 1 and 100
     or jsonb_typeof(p_post -> 'visual') is distinct from 'object'
     or p_post #>> '{visual,kind}' is distinct from 'pattern'
     or jsonb_typeof(p_post #> '{visual,seed}') is distinct from 'string'
     or char_length(p_post #>> '{visual,seed}') not between 16 and 128
     or jsonb_typeof(p_post #> '{visual,templateVersion}') is distinct from 'string'
     or char_length(btrim(p_post #>> '{visual,templateVersion}')) not between 1 and 64
     or jsonb_typeof(p_post -> 'oneLineSummary') is distinct from 'object'
     or jsonb_typeof(p_post #> '{oneLineSummary,text}') is distinct from 'string'
     or char_length(btrim(p_post #>> '{oneLineSummary,text}')) not between 1 and 260
     or jsonb_typeof(p_post #> '{oneLineSummary,sourceIds}') is distinct from 'array'
     or jsonb_array_length(p_post #> '{oneLineSummary,sourceIds}') < 1
     or jsonb_typeof(p_post -> 'body') is distinct from 'array'
     or jsonb_array_length(p_post -> 'body') not between 3 and 5
     or jsonb_typeof(p_post -> 'questions') is distinct from 'array'
     or jsonb_array_length(p_post -> 'questions') not between 1 and 2
     or jsonb_typeof(p_post -> 'sources') is distinct from 'array'
     or jsonb_array_length(p_post -> 'sources') < 1 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_post #> '{oneLineSummary,sourceIds}') as item(value)
    where jsonb_typeof(value) <> 'string'
       or (value #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ) or (
    select count(*) <> count(distinct value #>> '{}')
    from jsonb_array_elements(p_post #> '{oneLineSummary,sourceIds}') as item(value)
  ) then
    return false;
  end if;

  for v_paragraph in select value from jsonb_array_elements(p_post -> 'body') as item(value) loop
    if jsonb_typeof(v_paragraph) <> 'object'
       or jsonb_typeof(v_paragraph -> 'claims') is distinct from 'array'
       or jsonb_array_length(v_paragraph -> 'claims') < 1 then
      return false;
    end if;
    for v_claim in select value from jsonb_array_elements(v_paragraph -> 'claims') as item(value) loop
      if jsonb_typeof(v_claim) <> 'object'
         or jsonb_typeof(v_claim -> 'text') is distinct from 'string'
         or char_length(btrim(v_claim ->> 'text')) not between 1 and 260
         or jsonb_typeof(v_claim -> 'sourceIds') is distinct from 'array'
         or jsonb_array_length(v_claim -> 'sourceIds') < 1 then
        return false;
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_claim -> 'sourceIds') as item(value)
        where jsonb_typeof(value) <> 'string'
           or (value #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      ) or (
        select count(*) <> count(distinct value #>> '{}')
        from jsonb_array_elements(v_claim -> 'sourceIds') as item(value)
      ) then
        return false;
      end if;
    end loop;
  end loop;

  for v_question in select value from jsonb_array_elements(p_post -> 'questions') as item(value) loop
    if jsonb_typeof(v_question) is distinct from 'string'
       or char_length(btrim(v_question #>> '{}')) not between 1 and 80 then
      return false;
    end if;
  end loop;

  if (
    select count(*) <> count(distinct value ->> 'id')
    from jsonb_array_elements(p_post -> 'sources') as item(value)
  ) then
    return false;
  end if;
  for v_source in select value from jsonb_array_elements(p_post -> 'sources') as item(value) loop
    if jsonb_typeof(v_source) <> 'object'
       or coalesce(
         (v_source ->> 'id') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
         false
       ) = false
       or jsonb_typeof(v_source -> 'title') is distinct from 'string'
       or char_length(btrim(v_source ->> 'title')) not between 1 and 500
       or jsonb_typeof(v_source -> 'publisher') is distinct from 'string'
       or char_length(btrim(v_source ->> 'publisher')) not between 1 and 200
       or not (v_source ? 'publishedDate')
       or (
         v_source -> 'publishedDate' <> 'null'::jsonb
         and (
           jsonb_typeof(v_source -> 'publishedDate') <> 'string'
           or (v_source ->> 'publishedDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         )
       )
       or jsonb_typeof(v_source -> 'originalUrl') is distinct from 'string'
       or (v_source ->> 'originalUrl') !~ '^https://' then
      return false;
    end if;
  end loop;

  for v_source_id in
    select value from jsonb_array_elements(p_post #> '{oneLineSummary,sourceIds}')
    union
    select source_id.value
    from jsonb_array_elements(p_post -> 'body') as paragraph(value)
    cross join lateral jsonb_array_elements(paragraph.value -> 'claims') as body_claim(value)
    cross join lateral jsonb_array_elements(body_claim.value -> 'sourceIds') as source_id(value)
  loop
    if not exists (
      select 1 from jsonb_array_elements(p_post -> 'sources') as source(value)
      where source.value ->> 'id' = v_source_id #>> '{}'
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Safe, denormalized public projection. No draft, source passage, prompt or audit
-- column exists here. It is written only by public.publish_post().
create table public.published_posts (
  id text primary key references news_clipping_private.posts(id) on delete restrict,
  slug text not null unique,
  status text not null default 'published' check (status = 'published'),
  publication_date_kst date not null unique,
  published_at timestamptz not null,
  modified_at timestamptz not null check (modified_at >= published_at),
  title text not null,
  summary text not null,
  visual jsonb not null check (jsonb_typeof(visual) = 'object'),
  one_line_summary jsonb not null check (jsonb_typeof(one_line_summary) = 'object'),
  body jsonb not null check (jsonb_typeof(body) = 'array' and jsonb_array_length(body) between 3 and 5),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 2),
  sources jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) >= 1),
  constraint published_projection_kst_date check (
    publication_date_kst = (published_at at time zone 'Asia/Seoul')::date
  ),
  constraint published_projection_nested_contract check (
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

create index articles_published_at_desc on news_clipping_private.articles(published_at desc, id desc);
create index articles_source_discovered on news_clipping_private.articles(source_id, discovered_at desc);
create index evidence_items_article on news_clipping_private.evidence_items(article_id);
create index topics_run on news_clipping_private.topics(run_id, selected);
create index posts_published_at_desc on news_clipping_private.posts(published_at desc, id desc) where status = 'published';
create index pipeline_artifacts_run_created on news_clipping_private.pipeline_artifacts(run_id, created_at);
create index model_calls_run_started on news_clipping_private.model_calls(run_id, started_at);
create index published_posts_list on public.published_posts(published_at desc, id desc);

create function news_clipping_private.reject_immutable_row_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, news_clipping_private
as $$
begin
  raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD';
end;
$$;

create trigger post_revisions_are_immutable
before update or delete on news_clipping_private.post_revisions
for each row execute function news_clipping_private.reject_immutable_row_mutation();

create trigger pipeline_artifacts_are_immutable
before update or delete on news_clipping_private.pipeline_artifacts
for each row execute function news_clipping_private.reject_immutable_row_mutation();

create trigger pipeline_artifact_parents_are_immutable
before update or delete on news_clipping_private.pipeline_artifact_parents
for each row execute function news_clipping_private.reject_immutable_row_mutation();

create trigger model_calls_are_immutable
before update or delete on news_clipping_private.model_calls
for each row execute function news_clipping_private.reject_immutable_row_mutation();

create function news_clipping_private.pipeline_stage_rank(p_stage text)
returns integer
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select array_position(
    array['collect','normalize','deduplicate','score','retrieve','generate','validate','publish','cache_refresh']::text[],
    p_stage
  );
$$;

create function news_clipping_private.validate_pipeline_artifact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_parent_reference text;
  v_parent news_clipping_private.pipeline_artifacts%rowtype;
  v_required_parent_stage text;
  v_has_required_parent boolean := false;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(jsonb_build_array(new.run_id, new.stage)::text, 0)
  );

  if not (
    (new.stage = 'collect' and new.kind = 'news_ingestion')
    or (new.stage = 'score' and new.kind = 'topic_selection')
    or (new.stage = 'generate' and new.kind = 'post_generation')
    or (new.stage = 'validate' and new.kind = 'publication')
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
  end if;

  if cardinality(new.parent_output_references) <>
     (select count(distinct value) from unnest(new.parent_output_references) as value) then
    raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
  end if;

  if (new.stage = 'collect' and cardinality(new.parent_output_references) <> 0)
     or (new.stage <> 'collect' and cardinality(new.parent_output_references) = 0) then
    raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
  end if;

  v_required_parent_stage := case new.stage
    when 'score' then 'collect'
    when 'generate' then 'score'
    when 'validate' then 'generate'
  end;
  foreach v_parent_reference in array new.parent_output_references loop
    select * into v_parent
      from news_clipping_private.pipeline_artifacts
      where output_reference = v_parent_reference;
    if not found
       or v_parent.run_id <> new.run_id
       or news_clipping_private.pipeline_stage_rank(v_parent.stage) >= news_clipping_private.pipeline_stage_rank(new.stage) then
      raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
    end if;
    if v_parent.stage = v_required_parent_stage then
      v_has_required_parent := true;
    end if;
  end loop;

  if v_required_parent_stage is not null and not v_has_required_parent then
    raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
  end if;

  if new.kind = 'publication' and (
    new.payload ->> 'kind' <> 'publication'
    or jsonb_typeof(new.payload #> '{value}') is distinct from 'object'
    or news_clipping_private.is_valid_published_post(new.payload #> '{value,post}') is distinct from true
    or new.payload #> '{value,qualityResult,passed}' is distinct from 'true'::jsonb
    or jsonb_typeof(new.payload #> '{value,generationOutputReference}') is distinct from 'string'
    or not ((new.payload #>> '{value,generationOutputReference}') = any(new.parent_output_references))
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_ARTIFACT_LINEAGE';
  end if;

  if exists (
    select 1 from news_clipping_private.pipeline_artifacts existing
    where existing.run_id = new.run_id and existing.stage = new.stage
  ) then
    raise exception using errcode = 'P0001', message = 'OUTPUT_CONFLICT';
  end if;
  return new;
end;
$$;

create trigger pipeline_artifact_lineage_guard
before insert on news_clipping_private.pipeline_artifacts
for each row execute function news_clipping_private.validate_pipeline_artifact();

create function news_clipping_private.insert_pipeline_artifact_parent_rows()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
begin
  insert into news_clipping_private.pipeline_artifact_parents(child_artifact_id, parent_artifact_id)
  select new.id, parent.id
  from unnest(new.parent_output_references) as requested(output_reference)
  join news_clipping_private.pipeline_artifacts parent using (output_reference);
  return new;
end;
$$;

create trigger pipeline_artifact_parent_rows
after insert on news_clipping_private.pipeline_artifacts
for each row execute function news_clipping_private.insert_pipeline_artifact_parent_rows();

create function news_clipping_private.iso_json(p_value timestamptz)
returns jsonb
language sql
stable
strict
set search_path = pg_catalog
as $$
  select to_jsonb(to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;

create function news_clipping_private.lease_json(p_row news_clipping_private.daily_runs)
returns jsonb
language sql
stable
strict
set search_path = pg_catalog, news_clipping_private
as $$
  select jsonb_build_object(
    'runDate', p_row.run_date::text,
    'runId', p_row.run_id,
    'ownerId', p_row.owner_id,
    'leaseToken', p_row.lease_token,
    'fence', p_row.fence,
    'acquiredAt', news_clipping_private.iso_json(p_row.lease_acquired_at),
    'expiresAt', news_clipping_private.iso_json(p_row.lease_expires_at)
  );
$$;

create function news_clipping_private.assert_journal_transition(p_previous jsonb, p_next jsonb)
returns void
language plpgsql
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_index integer;
  v_step jsonb;
  v_next_step jsonb;
  v_previous_stages jsonb;
  v_next_stages jsonb;
begin
  if (p_next ->> 'revision')::integer <> (p_previous ->> 'revision')::integer + 1
     or p_next ->> 'schemaVersion' <> p_previous ->> 'schemaVersion'
     or p_next ->> 'startedAt' <> p_previous ->> 'startedAt'
     or p_next #>> '{run,runId}' <> p_previous #>> '{run,runId}'
     or p_next #>> '{run,runDate}' <> p_previous #>> '{run,runDate}'
     or p_next #>> '{run,pipelineVersion}' <> p_previous #>> '{run,pipelineVersion}'
     or p_next #> '{run,limits}' <> p_previous #> '{run,limits}'
     or (p_next ->> 'updatedAt')::timestamptz < (p_previous ->> 'updatedAt')::timestamptz
  then
    raise exception using errcode = 'P0001', message = 'JOURNAL_REGRESSION';
  end if;

  select coalesce(jsonb_agg(value -> 'stage' order by ordinal), '[]'::jsonb)
    into v_previous_stages
    from jsonb_array_elements(p_previous #> '{run,steps}') with ordinality as step(value, ordinal);
  select coalesce(jsonb_agg(value -> 'stage' order by ordinal), '[]'::jsonb)
    into v_next_stages
    from jsonb_array_elements(p_next #> '{run,steps}') with ordinality as step(value, ordinal);
  if v_previous_stages <> v_next_stages then
    raise exception using errcode = 'P0001', message = 'JOURNAL_REGRESSION';
  end if;

  if (p_next #>> '{run,usage,modelCalls}')::numeric < (p_previous #>> '{run,usage,modelCalls}')::numeric
     or (p_next #>> '{run,usage,inputTokens}')::numeric < (p_previous #>> '{run,usage,inputTokens}')::numeric
     or (p_next #>> '{run,usage,outputTokens}')::numeric < (p_previous #>> '{run,usage,outputTokens}')::numeric
     or (p_next #>> '{run,usage,estimatedCostUsd}')::numeric < (p_previous #>> '{run,usage,estimatedCostUsd}')::numeric
     or ((p_previous #>> '{run,usage,hasUnpricedCalls}')::boolean and not (p_next #>> '{run,usage,hasUnpricedCalls}')::boolean)
  then
    raise exception using errcode = 'P0001', message = 'JOURNAL_REGRESSION';
  end if;

  if p_previous -> 'terminalReason' <> 'null'::jsonb
     and p_next -> 'terminalReason' <> p_previous -> 'terminalReason' then
    raise exception using errcode = 'P0001', message = 'JOURNAL_REGRESSION';
  end if;

  for v_index in 0 .. jsonb_array_length(p_previous -> 'attempts') - 1 loop
    if p_next -> 'attempts' -> v_index <> p_previous -> 'attempts' -> v_index then
      raise exception using errcode = 'P0001', message = 'JOURNAL_REGRESSION';
    end if;
  end loop;

  for v_step in
    select value from jsonb_array_elements(p_previous #> '{run,steps}')
    where value ->> 'status' = 'succeeded'
  loop
    select value into v_next_step
    from jsonb_array_elements(p_next #> '{run,steps}')
    where value ->> 'stage' = v_step ->> 'stage';
    if not found or v_next_step <> v_step then
      raise exception using errcode = 'P0001', message = 'JOURNAL_REGRESSION';
    end if;
  end loop;
end;
$$;

create function public.acquire_daily_run(
  p_run_date date,
  p_requested_lease jsonb,
  p_initial_journal jsonb,
  p_requested_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_duration interval;
  v_row news_clipping_private.daily_runs%rowtype;
  v_journal jsonb;
  v_terminal boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));

  if p_requested_lease ->> 'runDate' <> p_run_date::text
     or p_initial_journal #>> '{run,runDate}' <> p_run_date::text
     or p_requested_lease ->> 'runId' <> p_initial_journal #>> '{run,runId}' then
    raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH';
  end if;
  if (p_requested_lease ->> 'ownerId') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     or (p_requested_lease ->> 'leaseToken') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;

  v_duration := (p_requested_lease ->> 'expiresAt')::timestamptz
                - (p_requested_lease ->> 'acquiredAt')::timestamptz;
  if v_duration <= interval '0 seconds' or v_duration > interval '24 hours' then
    raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED';
  end if;

  select * into v_row from news_clipping_private.daily_runs
  where run_date = p_run_date for update;

  if not found then
    if (p_initial_journal ->> 'revision')::integer <> 0
       or p_initial_journal #>> '{run,status}' <> 'running'
       or p_initial_journal -> 'finishedAt' <> 'null'::jsonb
       or p_initial_journal -> 'terminalReason' <> 'null'::jsonb
       or jsonb_array_length(p_initial_journal -> 'attempts') <> 0 then
      raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
    end if;
    v_journal := jsonb_set(
      jsonb_set(p_initial_journal, '{startedAt}', news_clipping_private.iso_json(v_now), false),
      '{updatedAt}', news_clipping_private.iso_json(v_now), false
    );
    insert into news_clipping_private.daily_runs(
      run_date, run_id, journal, journal_revision, status,
      owner_id, lease_token, fence, lease_acquired_at, lease_expires_at,
      last_client_observed_at, created_at, updated_at
    ) values (
      p_run_date, p_requested_lease ->> 'runId', v_journal, 0, 'running',
      p_requested_lease ->> 'ownerId', p_requested_lease ->> 'leaseToken', 1,
      v_now, v_now + v_duration, p_requested_now, v_now, v_now
    ) returning * into v_row;
    return jsonb_build_object(
      'status', 'acquired', 'lease', news_clipping_private.lease_json(v_row),
      'journal', v_row.journal, 'recoveredExpiredLease', false
    );
  end if;

  v_terminal := v_row.status in ('succeeded','succeeded_without_publish','published_with_warning','failed','blocked');
  if v_terminal then
    return jsonb_build_object('status', 'terminal', 'journal', v_row.journal);
  end if;
  if v_row.lease_expires_at > v_now then
    return jsonb_build_object(
      'status', 'busy', 'runDate', v_row.run_date::text, 'runId', v_row.run_id,
      'ownerId', v_row.owner_id, 'expiresAt', news_clipping_private.iso_json(v_row.lease_expires_at)
    );
  end if;
  if v_row.lease_token is null then
    raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND';
  end if;

  update news_clipping_private.daily_runs set
    owner_id = p_requested_lease ->> 'ownerId',
    lease_token = p_requested_lease ->> 'leaseToken',
    fence = fence + 1,
    lease_acquired_at = v_now,
    lease_expires_at = v_now + v_duration,
    last_client_observed_at = p_requested_now,
    updated_at = v_now
  where run_date = p_run_date returning * into v_row;

  return jsonb_build_object(
    'status', 'acquired', 'lease', news_clipping_private.lease_json(v_row),
    'journal', v_row.journal, 'recoveredExpiredLease', true
  );
end;
$$;

create function public.checkpoint_daily_run(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_journal jsonb,
  p_requested_renewed_at timestamptz,
  p_requested_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_duration interval := p_requested_expires_at - p_requested_renewed_at;
  v_row news_clipping_private.daily_runs%rowtype;
  v_next jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));
  select * into v_row from news_clipping_private.daily_runs
    where run_date = p_run_date for update;
  if not found then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_row.lease_token is null then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_row.lease_token <> p_lease_token then raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH'; end if;
  if v_row.fence <> p_fence then raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH'; end if;
  if v_row.run_id <> p_run_id or p_journal #>> '{run,runId}' <> p_run_id
     or p_journal #>> '{run,runDate}' <> p_run_date::text then
    raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH';
  end if;
  if v_row.journal_revision <> p_expected_revision
     or (p_journal ->> 'revision')::integer <> p_expected_revision + 1 then
    raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION';
  end if;
  if v_row.lease_expires_at <= v_now then raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED'; end if;
  if v_duration <= interval '0 seconds' or v_duration > interval '24 hours' then
    raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED';
  end if;
  if p_journal #>> '{run,status}' <> 'running'
     or p_journal -> 'finishedAt' <> 'null'::jsonb
     or p_journal -> 'terminalReason' <> 'null'::jsonb then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;

  perform news_clipping_private.assert_journal_transition(v_row.journal, p_journal);
  v_next := jsonb_set(p_journal, '{updatedAt}', news_clipping_private.iso_json(v_now), false);
  update news_clipping_private.daily_runs set
    journal = v_next,
    journal_revision = p_expected_revision + 1,
    status = v_next #>> '{run,status}',
    lease_acquired_at = v_now,
    lease_expires_at = v_now + v_duration,
    last_client_observed_at = p_requested_renewed_at,
    updated_at = v_now
  where run_date = p_run_date returning * into v_row;
  return jsonb_build_object('journal', v_row.journal, 'lease', news_clipping_private.lease_json(v_row));
end;
$$;

create function public.finish_daily_run(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_journal jsonb,
  p_requested_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row news_clipping_private.daily_runs%rowtype;
  v_next jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));
  select * into v_row from news_clipping_private.daily_runs
    where run_date = p_run_date for update;
  if not found then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_row.lease_token is null then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_row.lease_token <> p_lease_token then raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH'; end if;
  if v_row.fence <> p_fence then raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH'; end if;
  if v_row.lease_expires_at <= v_now then raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED'; end if;
  if v_row.run_id <> p_run_id or p_journal #>> '{run,runId}' <> p_run_id
     or p_journal #>> '{run,runDate}' <> p_run_date::text then
    raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH';
  end if;
  if v_row.journal_revision <> p_expected_revision
     or (p_journal ->> 'revision')::integer <> p_expected_revision + 1 then
    raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION';
  end if;
  if p_journal #>> '{run,status}' not in ('succeeded','succeeded_without_publish','published_with_warning','failed','blocked')
     or p_journal #>> '{run,currentStage}' is not null
     or p_journal -> 'finishedAt' = 'null'::jsonb then
    raise exception using errcode = 'P0001', message = 'TERMINAL_JOURNAL_REQUIRED';
  end if;

  perform news_clipping_private.assert_journal_transition(v_row.journal, p_journal);
  v_next := jsonb_set(
    jsonb_set(p_journal, '{updatedAt}', news_clipping_private.iso_json(v_now), false),
    '{finishedAt}', news_clipping_private.iso_json(v_now), false
  );
  update news_clipping_private.daily_runs set
    journal = v_next,
    journal_revision = p_expected_revision + 1,
    status = v_next #>> '{run,status}',
    owner_id = null, lease_token = null,
    lease_acquired_at = null, lease_expires_at = null,
    last_client_observed_at = p_requested_now,
    updated_at = v_now, finished_at = v_now
  where run_date = p_run_date returning * into v_row;
  return v_row.journal;
end;
$$;

create function public.get_daily_run(p_run_date date)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, news_clipping_private
as $$
  select journal from news_clipping_private.daily_runs where run_date = p_run_date;
$$;

-- Atomic publication RPC. p_post uses PublishedPostDetail camelCase JSON.
-- sources[*].id is the evidence_items.id used by public claim sourceIds.
-- Server time replaces publicationDateKst/publishedAt/modifiedAt. The function
-- locks and validates the daily run lease/fence/revision before any post write.
create function public.publish_post(
  p_run_date date,
  p_run_id text,
  p_lease_token text,
  p_fence bigint,
  p_expected_revision integer,
  p_validation_output_reference text,
  p_revision_id text,
  p_topic_id text,
  p_post jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_run news_clipping_private.daily_runs%rowtype;
  v_post_id text := p_post ->> 'id';
  v_slug text := p_post ->> 'slug';
  v_detail jsonb;
  v_source jsonb;
  v_source_id text;
  v_source_count integer;
  v_distinct_source_count integer;
  v_evidence news_clipping_private.evidence_items%rowtype;
  v_existing news_clipping_private.posts%rowtype;
  v_validate_step jsonb;
  v_validation_artifact news_clipping_private.pipeline_artifacts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('news-clipping-daily:' || p_run_date::text, 0));
  select * into v_run from news_clipping_private.daily_runs where run_date = p_run_date for update;
  if not found then raise exception using errcode = 'P0001', message = 'LEASE_NOT_FOUND'; end if;
  if v_run.lease_token <> p_lease_token then raise exception using errcode = 'P0001', message = 'LEASE_TOKEN_MISMATCH'; end if;
  if v_run.fence <> p_fence then raise exception using errcode = 'P0001', message = 'FENCE_MISMATCH'; end if;
  if v_run.run_id <> p_run_id then raise exception using errcode = 'P0001', message = 'RUN_ID_MISMATCH'; end if;
  if v_run.journal_revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'STALE_JOURNAL_REVISION'; end if;
  if v_run.lease_expires_at is null or v_run.lease_expires_at <= v_now then
    raise exception using errcode = 'P0001', message = 'LEASE_EXPIRED';
  end if;
  if v_run.status <> 'running' or v_run.journal #>> '{run,currentStage}' <> 'publish' then
    raise exception using errcode = 'P0001', message = 'ACTIVE_JOURNAL_REQUIRED';
  end if;
  if jsonb_typeof(v_run.journal #> '{run,steps}') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  select value into v_validate_step
  from jsonb_array_elements(v_run.journal #> '{run,steps}') as step(value)
  where value ->> 'stage' = 'validate';
  if not found
     or v_validate_step ->> 'status' <> 'succeeded'
     or v_validate_step ->> 'outputReference' is distinct from p_validation_output_reference then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  select * into v_validation_artifact
  from news_clipping_private.pipeline_artifacts
  where output_reference = p_validation_output_reference;
  if not found
     or v_validation_artifact.run_id <> p_run_id
     or v_validation_artifact.stage <> 'validate'
     or v_validation_artifact.kind <> 'publication'
     or v_validation_artifact.payload ->> 'kind' <> 'publication'
     or v_validation_artifact.payload #> '{value,qualityResult,passed}' is distinct from 'true'::jsonb
     or not (
       (v_validation_artifact.payload #>> '{value,generationOutputReference}') =
       any(v_validation_artifact.parent_output_references)
     )
     or v_validation_artifact.payload #> '{value,post}' is distinct from p_post then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  if (v_now at time zone 'Asia/Seoul')::date <> p_run_date then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_PUBLICATION_DATE';
  end if;
  if not coalesce(v_post_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false)
     or not coalesce(p_revision_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false)
     or not coalesce(v_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$', false)
     or coalesce(char_length(v_slug), 121) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;
  if not exists (
    select 1 from news_clipping_private.topics
    where id = p_topic_id and run_id = p_run_id and run_date = p_run_date and selected
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;

  select * into v_existing from news_clipping_private.posts where published_by_run_id = p_run_id;
  if found then
    if v_existing.id = v_post_id and v_existing.slug = v_slug and v_existing.publication_date_kst = p_run_date
       and v_existing.active_revision_id = p_revision_id and v_existing.status = 'published' then
      select detail into v_detail from news_clipping_private.post_revisions
        where id = p_revision_id and post_id = v_post_id;
      return v_detail;
    end if;
    raise exception using errcode = 'P0001', message = 'DUPLICATE_PUBLICATION_DATE';
  end if;
  if exists (select 1 from news_clipping_private.posts where publication_date_kst = p_run_date) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_PUBLICATION_DATE';
  end if;
  if exists (select 1 from news_clipping_private.posts where slug = v_slug) then
    raise exception using errcode = 'P0001', message = 'SLUG_CONFLICT';
  end if;

  if news_clipping_private.is_valid_published_post(p_post) is distinct from true then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;

  select count(*), count(distinct value ->> 'id')
    into v_source_count, v_distinct_source_count
    from jsonb_array_elements(p_post -> 'sources') as source(value);
  if v_source_count <> v_distinct_source_count then
    raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
  end if;

  v_detail := p_post || jsonb_build_object(
    'id', v_post_id,
    'slug', v_slug,
    'publicationDateKst', p_run_date::text,
    'publishedAt', news_clipping_private.iso_json(v_now),
    'modifiedAt', news_clipping_private.iso_json(v_now)
  );

  for v_source_id in
    select jsonb_array_elements_text(v_detail #> '{oneLineSummary,sourceIds}')
    union
    select jsonb_array_elements_text(claim -> 'sourceIds')
    from jsonb_array_elements(v_detail -> 'body') as paragraph(value)
    cross join lateral jsonb_array_elements(paragraph.value -> 'claims') as body_claim(claim)
  loop
    if not exists (
      select 1 from jsonb_array_elements(v_detail -> 'sources') as source(value)
      where source.value ->> 'id' = v_source_id
    ) then
      raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
    end if;
  end loop;

  insert into news_clipping_private.posts(
    id, slug, publication_date_kst, topic_id, published_by_run_id, status,
    active_revision_id, published_at, modified_at, title, summary, visual
  ) values (
    v_post_id, v_slug, p_run_date, p_topic_id, p_run_id, 'validated',
    null, null, v_now, p_post ->> 'title', p_post ->> 'summary', p_post -> 'visual'
  );
  insert into news_clipping_private.post_revisions(id, post_id, detail, created_at)
    values (p_revision_id, v_post_id, v_detail, v_now);

  for v_source in
    select value || jsonb_build_object('_order', ordinality - 1)
    from jsonb_array_elements(v_detail -> 'sources') with ordinality as source(value, ordinality)
  loop
    v_source_id := v_source ->> 'id';
    select * into v_evidence from news_clipping_private.evidence_items where id = v_source_id;
    if not found
       or not exists (
         select 1 from news_clipping_private.topic_evidence
         where topic_id = p_topic_id and evidence_id = v_source_id
       )
       or v_source ->> 'title' <> v_evidence.title
       or v_source ->> 'publisher' <> v_evidence.source_name
       or v_source ->> 'originalUrl' <> v_evidence.url
       or (v_source ->> 'publishedDate') is distinct from (v_evidence.published_at at time zone 'Asia/Seoul')::date::text then
      raise exception using errcode = 'P0001', message = 'INVALID_SOURCE_DATA';
    end if;
    insert into news_clipping_private.post_sources(post_id, evidence_id, article_id, source_id, display_order)
      values (v_post_id, v_evidence.id, v_evidence.article_id, v_evidence.source_id, (v_source ->> '_order')::smallint);
  end loop;

  update news_clipping_private.posts set
    status = 'published', active_revision_id = p_revision_id,
    published_at = v_now, modified_at = v_now
  where id = v_post_id;

  insert into public.published_posts(
    id, slug, status, publication_date_kst, published_at, modified_at,
    title, summary, visual, one_line_summary, body, questions, sources
  ) values (
    v_post_id, v_slug, 'published', p_run_date, v_now, v_now,
    v_detail ->> 'title', v_detail ->> 'summary', v_detail -> 'visual',
    v_detail -> 'oneLineSummary', v_detail -> 'body', v_detail -> 'questions', v_detail -> 'sources'
  );
  return v_detail;
end;
$$;

alter table news_clipping_private.sources enable row level security;
alter table news_clipping_private.articles enable row level security;
alter table news_clipping_private.evidence_items enable row level security;
alter table news_clipping_private.daily_runs enable row level security;
alter table news_clipping_private.topics enable row level security;
alter table news_clipping_private.topic_articles enable row level security;
alter table news_clipping_private.topic_evidence enable row level security;
alter table news_clipping_private.posts enable row level security;
alter table news_clipping_private.post_revisions enable row level security;
alter table news_clipping_private.post_sources enable row level security;
alter table news_clipping_private.pipeline_artifacts enable row level security;
alter table news_clipping_private.pipeline_artifact_parents enable row level security;
alter table news_clipping_private.model_calls enable row level security;
alter table news_clipping_private.model_call_evidence enable row level security;

alter table news_clipping_private.sources force row level security;
alter table news_clipping_private.articles force row level security;
alter table news_clipping_private.evidence_items force row level security;
alter table news_clipping_private.daily_runs force row level security;
alter table news_clipping_private.topics force row level security;
alter table news_clipping_private.topic_articles force row level security;
alter table news_clipping_private.topic_evidence force row level security;
alter table news_clipping_private.posts force row level security;
alter table news_clipping_private.post_revisions force row level security;
alter table news_clipping_private.post_sources force row level security;
alter table news_clipping_private.pipeline_artifacts force row level security;
alter table news_clipping_private.pipeline_artifact_parents force row level security;
alter table news_clipping_private.model_calls force row level security;
alter table news_clipping_private.model_call_evidence force row level security;

alter table public.published_posts enable row level security;
alter table public.published_posts force row level security;
create policy published_posts_read_only
  on public.published_posts for select
  to anon, authenticated
  using (status = 'published');

revoke all on all tables in schema news_clipping_private from public, anon, authenticated;
revoke all on all functions in schema news_clipping_private from public, anon, authenticated;
revoke all on public.published_posts from public, anon, authenticated, service_role;
grant select on public.published_posts to anon, authenticated, service_role;

-- The server-only Supabase secret maps to service_role. Do not use it in the
-- browser. Direct grants exclude posts, revisions, daily_runs and the public
-- projection; those high-risk mutations are available only through RPCs.
grant usage on schema news_clipping_private to service_role;
grant select, insert, update on news_clipping_private.sources to service_role;
grant select, insert, update on news_clipping_private.articles to service_role;
grant select, insert on news_clipping_private.evidence_items to service_role;
grant select, insert on news_clipping_private.topics to service_role;
grant select, insert on news_clipping_private.topic_articles to service_role;
grant select, insert on news_clipping_private.topic_evidence to service_role;
grant select, insert on news_clipping_private.pipeline_artifacts to service_role;
grant select on news_clipping_private.pipeline_artifact_parents to service_role;
grant select, insert on news_clipping_private.model_calls to service_role;
grant select, insert on news_clipping_private.model_call_evidence to service_role;

revoke all on function public.acquire_daily_run(date, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.checkpoint_daily_run(date, text, text, bigint, integer, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_daily_run(date, text, text, bigint, integer, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.get_daily_run(date) from public, anon, authenticated;
revoke all on function public.publish_post(date, text, text, bigint, integer, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function news_clipping_private.insert_pipeline_artifact_parent_rows() from public, anon, authenticated, service_role;
revoke all on function news_clipping_private.validate_pipeline_artifact() from public, anon, authenticated, service_role;

grant execute on function public.acquire_daily_run(date, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.checkpoint_daily_run(date, text, text, bigint, integer, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.finish_daily_run(date, text, text, bigint, integer, jsonb, timestamptz) to service_role;
grant execute on function public.get_daily_run(date) to service_role;
grant execute on function public.publish_post(date, text, text, bigint, integer, text, text, text, jsonb) to service_role;

comment on function public.acquire_daily_run(date, jsonb, jsonb, timestamptz) is
  'Server-only RPC. Client now is audit input; clock_timestamp is authoritative. Returns acquired/busy/terminal DailyRunAcquireResult JSON.';
comment on function public.checkpoint_daily_run(date, text, text, bigint, integer, jsonb, timestamptz, timestamptz) is
  'Server-only RPC. Row lock plus lease token, fence and expected journal revision CAS. Returns {journal,lease} JSON.';
comment on function public.finish_daily_run(date, text, text, bigint, integer, jsonb, timestamptz) is
  'Server-only RPC. Row lock plus unexpired lease/fence/revision CAS. Returns terminal journal JSON.';
comment on function public.get_daily_run(date) is
  'Server-only RPC. Returns a journal JSON object or null.';
comment on function public.publish_post(date, text, text, bigint, integer, text, text, text, jsonb) is
  'Server-only atomic publish. Requires a matching succeeded validate output plus current publish stage and unexpired lease/fence/revision; enforces one KST date, unique slug, nested public contract, immutable revision and evidence lineage.';

commit;
