-- Minimal stand-ins for the Supabase-managed schemas so the migrations can be
-- applied to a plain PostgreSQL for a syntax and dependency check.
-- Usage: psql -f supabase/test/harness.sql -f supabase/migrations/0001_init.sql
create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end
$$;
