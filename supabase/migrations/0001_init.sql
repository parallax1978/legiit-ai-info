-- Legiit Ai Info: initial schema.
-- Every table has RLS. Users reach their own rows through the anon key and the
-- session; the service role (server code only) does the rest.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.plan_t as enum ('free', 'paid', 'sponsored');
create type public.project_mode_t as enum ('crawl', 'manual');
create type public.project_status_t as enum ('new', 'crawling', 'review', 'generating', 'ready', 'failed');
create type public.platform_t as enum ('wordpress', 'shopify', 'wix', 'squarespace', 'webflow', 'other', 'unknown');
create type public.run_status_t as enum ('queued', 'running', 'done', 'failed', 'cancelled');
create type public.run_phase_t as enum ('discover', 'fetch', 'extract', 'merge', 'done', 'failed');
create type public.page_status_t as enum ('queued', 'fetched', 'skipped', 'failed', 'extracted');
create type public.generation_status_t as enum ('queued', 'writing', 'linting', 'done', 'failed');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  plan public.plan_t not null default 'free',
  stripe_customer_id text unique,
  stripe_subscription_id text,
  plan_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "profiles: owner can read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: owner can update email only"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- access codes (service role only; redeemed through server code)
-- ---------------------------------------------------------------------------
create table public.access_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text,
  max_uses integer not null default 1 check (max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  expires_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.access_codes enable row level security;

create table public.access_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.access_codes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (code_id, user_id)
);

alter table public.access_code_redemptions enable row level security;

create policy "redemptions: owner can read"
  on public.access_code_redemptions for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- templates (the page spec as data)
-- ---------------------------------------------------------------------------
create table public.templates (
  id text primary key,
  version integer not null default 1,
  name text not null,
  spec jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();

alter table public.templates enable row level security;

create policy "templates: signed-in users can read"
  on public.templates for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  site_url text not null,
  site_host text,
  business_name text,
  platform public.platform_t not null default 'unknown',
  platform_evidence jsonb not null default '[]'::jsonb,
  template_id text not null default 'about-v1' references public.templates (id),
  mode public.project_mode_t not null default 'crawl',
  status public.project_status_t not null default 'new',
  latest_crawl_run_id uuid,
  latest_fact_sheet_id uuid,
  latest_generation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_id_idx on public.projects (user_id, created_at desc);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

create policy "projects: owner full access"
  on public.projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- crawl runs and pages
-- ---------------------------------------------------------------------------
create table public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.run_status_t not null default 'queued',
  phase public.run_phase_t not null default 'discover',
  -- step state: the queue of URLs still to fetch, pages still to extract, etc.
  cursor jsonb not null default '{}'::jsonb,
  pages_planned integer not null default 0,
  pages_fetched integer not null default 0,
  pages_failed integer not null default 0,
  pages_extracted integer not null default 0,
  text_bytes bigint not null default 0,
  platform public.platform_t not null default 'unknown',
  platform_evidence jsonb not null default '[]'::jsonb,
  robots jsonb,
  sitemaps jsonb not null default '[]'::jsonb,
  log jsonb not null default '[]'::jsonb,
  error text,
  locked_at timestamptz,
  lock_token text,
  started_at timestamptz,
  finished_at timestamptz,
  cost_usd numeric(12, 6) not null default 0,
  fact_sheet_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crawl_runs_project_id_idx on public.crawl_runs (project_id, created_at desc);

create trigger crawl_runs_set_updated_at
  before update on public.crawl_runs
  for each row execute function public.set_updated_at();

alter table public.crawl_runs enable row level security;

create policy "crawl_runs: owner can read"
  on public.crawl_runs for select
  using (auth.uid() = user_id);

create table public.crawl_pages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.crawl_runs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  url text not null,
  normalized_url text not null,
  rank integer not null default 0,
  reason text,
  status public.page_status_t not null default 'queued',
  http_status integer,
  fetched_at timestamptz,
  title text,
  meta_description text,
  canonical text,
  lang text,
  text text,
  text_chars integer not null default 0,
  headings jsonb not null default '[]'::jsonb,
  html_path text,
  html_bytes integer,
  jsonld jsonb not null default '[]'::jsonb,
  links jsonb not null default '{}'::jsonb,
  images jsonb not null default '[]'::jsonb,
  findings jsonb,
  findings_dropped integer not null default 0,
  extract_tokens_in integer,
  extract_tokens_out integer,
  extract_cost_usd numeric(12, 6),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, normalized_url)
);

create index crawl_pages_run_id_idx on public.crawl_pages (run_id, rank);

create trigger crawl_pages_set_updated_at
  before update on public.crawl_pages
  for each row execute function public.set_updated_at();

alter table public.crawl_pages enable row level security;

create policy "crawl_pages: owner can read"
  on public.crawl_pages for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- fact sheets (versioned per project)
-- ---------------------------------------------------------------------------
create table public.fact_sheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  version integer not null,
  source text not null check (source in ('crawl', 'manual')),
  crawl_run_id uuid references public.crawl_runs (id) on delete set null,
  template_id text not null references public.templates (id),
  data jsonb not null default '{}'::jsonb,
  existing_schema jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version)
);

create trigger fact_sheets_set_updated_at
  before update on public.fact_sheets
  for each row execute function public.set_updated_at();

alter table public.fact_sheets enable row level security;

create policy "fact_sheets: owner can read"
  on public.fact_sheets for select
  using (auth.uid() = user_id);

create policy "fact_sheets: owner can update"
  on public.fact_sheets for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- generations (slice 3)
-- ---------------------------------------------------------------------------
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  version integer not null,
  fact_sheet_id uuid references public.fact_sheets (id) on delete set null,
  fact_sheet_version integer,
  status public.generation_status_t not null default 'queued',
  page_html text,
  wordpress_html text,
  schema jsonb,
  instructions_md text,
  still_to_fill jsonb not null default '[]'::jsonb,
  lint_report jsonb not null default '{}'::jsonb,
  model text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version)
);

create trigger generations_set_updated_at
  before update on public.generations
  for each row execute function public.set_updated_at();

alter table public.generations enable row level security;

create policy "generations: owner can read"
  on public.generations for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- llm calls (cost tracking)
-- ---------------------------------------------------------------------------
create table public.llm_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  project_id uuid references public.projects (id) on delete cascade,
  run_id uuid references public.crawl_runs (id) on delete set null,
  generation_id uuid references public.generations (id) on delete set null,
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  duration_ms integer,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);

create index llm_calls_project_id_idx on public.llm_calls (project_id, created_at desc);
create index llm_calls_user_id_idx on public.llm_calls (user_id, created_at desc);

alter table public.llm_calls enable row level security;

create policy "llm_calls: owner can read"
  on public.llm_calls for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- share links (slice 3) and usage events (slice 5)
-- ---------------------------------------------------------------------------
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  project_id uuid not null references public.projects (id) on delete cascade,
  generation_id uuid references public.generations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.share_links enable row level security;

create policy "share_links: owner full access"
  on public.share_links for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  kind text not null check (kind in ('project_created', 'crawl_started', 'generation_started')),
  created_at timestamptz not null default now()
);

create index usage_events_user_kind_idx on public.usage_events (user_id, kind, created_at desc);

alter table public.usage_events enable row level security;

create policy "usage_events: owner can read"
  on public.usage_events for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- storage: raw crawled HTML, private, service role only
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('crawl-html', 'crawl-html', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;
