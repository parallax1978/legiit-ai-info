-- Slice 3: the generation job keeps its draft, cursor, lock, and log on the row,
-- the way crawl_runs does, so a step can be retried from the row alone.

alter table public.generations
  add column if not exists draft jsonb,
  add column if not exists cursor jsonb not null default '{}'::jsonb,
  add column if not exists log jsonb not null default '[]'::jsonb,
  add column if not exists locked_at timestamptz,
  add column if not exists lock_token text,
  add column if not exists attempts integer not null default 0,
  add column if not exists title text,
  add column if not exists meta_description text,
  add column if not exists platform public.platform_t not null default 'unknown',
  add column if not exists page_url text;

create index if not exists generations_project_created_idx
  on public.generations (project_id, created_at desc);

create index if not exists share_links_token_idx on public.share_links (token);

-- updated_at moves on every update, as on the other tables.
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'generations_set_updated_at' and tgrelid = 'public.generations'::regclass
  ) then
    create trigger generations_set_updated_at
      before update on public.generations
      for each row execute function public.set_updated_at();
  end if;
end
$$;
