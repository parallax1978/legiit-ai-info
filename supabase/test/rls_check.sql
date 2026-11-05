-- Run after the harness and every migration, as the database owner:
--   psql -v ON_ERROR_STOP=1 -f harness.sql -f ../migrations/*.sql -f rls_check.sql
-- Acts as a signed-in user through the authenticated role and checks that the
-- writes the app forbids are refused and the reads it needs still work.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@example.com');
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'b@example.com');
insert into public.templates (id, name, spec) values ('about-v1', 'About', '{}') on conflict do nothing;
insert into public.projects (id, user_id, site_url) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'https://a.example.com/'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'https://b.example.com/');
insert into public.fact_sheets (id, project_id, user_id, version, source, template_id) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 1, 'crawl', 'about-v1');
insert into public.llm_calls (user_id, project_id, purpose, model, cost_usd) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'extract_page', 'claude-haiku-5-5', 0.01);

create or replace function pg_temp.expect_denied(sql text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'expected this to be refused: %', sql;
exception
  when insufficient_privilege then null;
end;
$$;

create or replace function pg_temp.expect_rows(sql text, expected int) returns void language plpgsql as $$
declare n int;
begin
  execute sql;
  get diagnostics n = row_count;
  if n <> expected then raise exception 'expected % rows, got %: %', expected, n, sql; end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- Reads the app needs.
select pg_temp.expect_rows('select * from public.profiles', 1);
select pg_temp.expect_rows('select * from public.projects', 1);
select pg_temp.expect_rows('select * from public.fact_sheets', 1);

-- Writes the app forbids.
select pg_temp.expect_denied($q$update public.profiles set plan = 'paid'$q$);
select pg_temp.expect_denied($q$insert into public.projects (user_id, site_url) values ('11111111-1111-1111-1111-111111111111', 'https://x.example.com/')$q$);
select pg_temp.expect_denied($q$update public.projects set status = 'ready'$q$);
select pg_temp.expect_denied($q$update public.fact_sheets set data = '{}'$q$);
select pg_temp.expect_denied($q$insert into public.usage_events (user_id, kind) values ('11111111-1111-1111-1111-111111111111', 'project_created')$q$);
select pg_temp.expect_denied($q$delete from public.llm_calls$q$);

-- Another user's rows are invisible and cannot be deleted.
select pg_temp.expect_rows($q$delete from public.projects where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$q$, 0);

-- Deleting your own project keeps the cost history.
select pg_temp.expect_rows($q$delete from public.projects where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$, 1);
reset role;
select pg_temp.expect_rows('select * from public.llm_calls where project_id is null', 1);

-- A run gets one fact sheet.
insert into public.crawl_runs (id, project_id, user_id) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');
insert into public.fact_sheets (project_id, user_id, version, source, template_id, crawl_run_id) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 1, 'crawl', 'about-v1', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
do $$
begin
  insert into public.fact_sheets (project_id, user_id, version, source, template_id, crawl_run_id) values
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 2, 'crawl', 'about-v1', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  raise exception 'a second fact sheet for one run was accepted';
exception
  when unique_violation then null;
end;
$$;

select 'rls checks passed' as result;
