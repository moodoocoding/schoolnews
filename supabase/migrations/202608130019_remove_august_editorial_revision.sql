begin;

drop function if exists public.apply_august_editorial_revision(date, text, text, text, jsonb, jsonb);
drop function if exists public.get_august_editorial_targets();

commit;
