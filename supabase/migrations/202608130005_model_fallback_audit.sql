begin;

alter table news_clipping_private.model_calls
  drop constraint if exists model_calls_run_id_purpose_attempt_number_key;

alter table news_clipping_private.model_calls
  add column if not exists route_attempt smallint not null default 1
    check (route_attempt between 1 and 2);

alter table news_clipping_private.model_calls
  add constraint model_calls_logical_route_unique
  unique (run_id, purpose, attempt_number, route_attempt);

comment on column news_clipping_private.model_calls.route_attempt is
  '1-based physical Gemini request within one logical draft/revision/review attempt.';

commit;
