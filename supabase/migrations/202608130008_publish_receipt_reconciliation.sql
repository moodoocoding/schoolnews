-- Read-only reconciliation for a publish_post response that may have been lost.
-- The exact four-part identity either proves the committed publication, is
-- wholly absent, or fails closed when partial/conflicting state is observed.

begin;

create or replace function public.get_publish_receipt(
  p_run_date date,
  p_run_id text,
  p_revision_id text,
  p_validation_output_reference text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, news_clipping_private
as $$
declare
  v_post news_clipping_private.posts%rowtype;
  v_revision news_clipping_private.post_revisions%rowtype;
  v_validation news_clipping_private.pipeline_artifacts%rowtype;
  v_public public.published_posts%rowtype;
  v_public_detail jsonb;
  v_related_count integer;
begin
  if p_run_date is null
     or coalesce(p_run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
     or coalesce(p_revision_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', false) = false
     or p_validation_output_reference is null
     or char_length(p_validation_output_reference) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_PUBLISH_RECEIPT_INPUT';
  end if;

  -- Serialize behind an in-flight publish_post for the same KST date. This
  -- function must remain VOLATILE so reads after the wait use a fresh snapshot.
  perform pg_advisory_xact_lock(
    hashtextextended('news-clipping-daily:' || p_run_date::text, 0)
  );

  select count(*) into v_related_count
  from news_clipping_private.posts
  where publication_date_kst = p_run_date
     or published_by_run_id = p_run_id
     or active_revision_id = p_revision_id;

  if v_related_count = 0 then
    if exists (
      select 1 from news_clipping_private.post_revisions where id = p_revision_id
    ) then
      raise exception using errcode = 'P0001', message = 'PUBLISH_RECEIPT_CONFLICT';
    end if;

    select * into v_validation
    from news_clipping_private.pipeline_artifacts
    where output_reference = p_validation_output_reference;
    if not found
       or v_validation.run_id is distinct from p_run_id
       or v_validation.stage is distinct from 'validate'
       or v_validation.kind is distinct from 'publication'
       or v_validation.payload ->> 'kind' is distinct from 'publication'
       or v_validation.payload #> '{value,qualityResult,passed}' is distinct from 'true'::jsonb
       or not (
         (v_validation.payload #>> '{value,generationOutputReference}') =
         any(v_validation.parent_output_references)
       )
       or news_clipping_private.is_valid_published_post(
         v_validation.payload #> '{value,post}'
       ) is distinct from true
       or v_validation.payload #>> '{value,post,publicationDateKst}' is distinct from p_run_date::text
       or coalesce(
         (v_validation.payload #>> '{value,post,id}') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
         false
       ) = false
       or coalesce(
         (v_validation.payload #>> '{value,post,slug}') ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$',
         false
       ) = false then
      raise exception using errcode = 'P0001', message = 'PUBLISH_RECEIPT_CONFLICT';
    end if;

    if exists (
      select 1 from news_clipping_private.posts
      where id = v_validation.payload #>> '{value,post,id}'
         or slug = v_validation.payload #>> '{value,post,slug}'
    ) or exists (
      select 1 from public.published_posts
      where id = v_validation.payload #>> '{value,post,id}'
         or slug = v_validation.payload #>> '{value,post,slug}'
         or publication_date_kst = p_run_date
    ) then
      raise exception using errcode = 'P0001', message = 'PUBLISH_RECEIPT_CONFLICT';
    end if;

    return null;
  end if;

  if v_related_count <> 1 then
    raise exception using errcode = 'P0001', message = 'PUBLISH_RECEIPT_CONFLICT';
  end if;

  select * into v_post
  from news_clipping_private.posts
  where publication_date_kst = p_run_date
     or published_by_run_id = p_run_id
     or active_revision_id = p_revision_id;

  if v_post.publication_date_kst is distinct from p_run_date
     or v_post.published_by_run_id is distinct from p_run_id
     or v_post.active_revision_id is distinct from p_revision_id
     or v_post.status is distinct from 'published'
     or v_post.published_at is null then
    raise exception using errcode = 'P0001', message = 'PUBLISH_RECEIPT_CONFLICT';
  end if;

  select * into v_revision
  from news_clipping_private.post_revisions
  where id = p_revision_id;
  if not found
     or v_revision.post_id is distinct from v_post.id
     or v_revision.detail ->> 'id' is distinct from v_post.id
     or v_revision.detail ->> 'slug' is distinct from v_post.slug
     or v_revision.detail ->> 'publicationDateKst' is distinct from p_run_date::text then
    raise exception using errcode = 'P0001', message = 'PUBLISH_RECEIPT_CONFLICT';
  end if;

  select * into v_validation
  from news_clipping_private.pipeline_artifacts
  where output_reference = p_validation_output_reference;
  if not found
     or v_validation.run_id is distinct from p_run_id
     or v_validation.stage is distinct from 'validate'
     or v_validation.kind is distinct from 'publication'
     or v_validation.payload ->> 'kind' is distinct from 'publication'
     or v_validation.payload #> '{value,qualityResult,passed}' is distinct from 'true'::jsonb
     or not (
       (v_validation.payload #>> '{value,generationOutputReference}') =
       any(v_validation.parent_output_references)
     )
     or v_validation.payload #>> '{value,post,id}' is distinct from v_post.id
     or v_validation.payload #>> '{value,post,slug}' is distinct from v_post.slug
     or v_validation.payload #>> '{value,post,publicationDateKst}' is distinct from p_run_date::text
     or (
       (v_validation.payload #> '{value,post}') - 'publishedAt' - 'modifiedAt'
     ) is distinct from (
       v_revision.detail - 'publishedAt' - 'modifiedAt'
     ) then
    raise exception using errcode = 'P0001', message = 'PUBLISH_RECEIPT_CONFLICT';
  end if;

  select * into v_public
  from public.published_posts
  where id = v_post.id;
  if not found
     or v_public.slug is distinct from v_post.slug
     or v_public.status is distinct from 'published'
     or v_public.publication_date_kst is distinct from p_run_date
     or v_public.published_at is distinct from v_post.published_at
     or v_public.modified_at is distinct from v_post.modified_at then
    raise exception using errcode = 'P0001', message = 'PUBLISH_RECEIPT_CONFLICT';
  end if;

  v_public_detail := jsonb_build_object(
    'id', v_public.id,
    'slug', v_public.slug,
    'publicationDateKst', v_public.publication_date_kst::text,
    'publishedAt', news_clipping_private.iso_json(v_public.published_at),
    'modifiedAt', news_clipping_private.iso_json(v_public.modified_at),
    'title', v_public.title,
    'summary', v_public.summary,
    'visual', v_public.visual,
    'oneLineSummary', v_public.one_line_summary,
    'body', v_public.body,
    'questions', v_public.questions,
    'sources', v_public.sources
  );

  if v_revision.detail is distinct from v_public_detail then
    raise exception using errcode = 'P0001', message = 'PUBLISH_RECEIPT_CONFLICT';
  end if;

  return jsonb_build_object(
    'runDate', p_run_date::text,
    'runId', p_run_id,
    'revisionId', p_revision_id,
    'validationOutputReference', p_validation_output_reference,
    'post', v_public_detail
  );
end;
$$;

revoke all on function public.get_publish_receipt(date, text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_publish_receipt(date, text, text, text)
  to service_role;

comment on function public.get_publish_receipt(date, text, text, text) is
  'Server-only exact publication reconciliation. Returns a receipt, null for wholly absent state, or PUBLISH_RECEIPT_CONFLICT.';

commit;
