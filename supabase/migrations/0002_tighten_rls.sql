-- Legiit Ai Info: tighten what the session client may write, keep cost and
-- usage history when a project is deleted, and make a run's fact sheet unique.
--
-- Every write in the app goes through server code with the service role after
-- an ownership check and validation (src/app/api/**). The session client only
-- reads. These policies make that the only way in: with the publishable key a
-- signed-in user could otherwise PATCH their own profile's plan to 'paid', write
-- arbitrary fact sheet JSON, or insert projects around the usage caps.

-- ---------------------------------------------------------------------------
-- profiles: read only. Created by the handle_new_user trigger, changed by
-- server code (Stripe webhooks, access codes) with the service role.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles: owner can update email only" on public.profiles;
revoke insert, update, delete on public.profiles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- projects: owners read and delete. Inserts and updates go through
-- POST /api/projects and the run machine, which enforce caps and validation.
-- ---------------------------------------------------------------------------
drop policy if exists "projects: owner full access" on public.projects;

create policy "projects: owner can read"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "projects: owner can delete"
  on public.projects for delete
  using (auth.uid() = user_id);

revoke insert, update on public.projects from anon, authenticated;

-- ---------------------------------------------------------------------------
-- fact_sheets: read only for owners. Edits go through
-- PATCH /api/fact-sheets/[id], which validates the field, the value type,
-- and the evidence.
-- ---------------------------------------------------------------------------
drop policy if exists "fact_sheets: owner can update" on public.fact_sheets;
revoke insert, update, delete on public.fact_sheets from anon, authenticated;

-- A run produces at most one fact sheet, so a merge retried after a timeout
-- finds the sheet it already wrote instead of adding a second version.
create unique index if not exists fact_sheets_crawl_run_id_key
  on public.fact_sheets (crawl_run_id)
  where crawl_run_id is not null;

-- ---------------------------------------------------------------------------
-- share_links: read only for owners; created and revoked by server code.
-- ---------------------------------------------------------------------------
drop policy if exists "share_links: owner full access" on public.share_links;

create policy "share_links: owner can read"
  on public.share_links for select
  using (auth.uid() = user_id);

revoke insert, update, delete on public.share_links from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables the session client never writes.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.crawl_runs from anon, authenticated;
revoke insert, update, delete on public.crawl_pages from anon, authenticated;
revoke insert, update, delete on public.generations from anon, authenticated;
revoke insert, update, delete on public.llm_calls from anon, authenticated;
revoke insert, update, delete on public.usage_events from anon, authenticated;
revoke insert, update, delete on public.access_codes from anon, authenticated;
revoke insert, update, delete on public.access_code_redemptions from anon, authenticated;
revoke insert, update, delete on public.templates from anon, authenticated;

-- ---------------------------------------------------------------------------
-- History that must outlive a deleted project: the cost of every model call
-- (the cost dashboard sets the price from it) and the usage events the
-- monthly caps count (deleting a project must not hand back its allowance).
-- ---------------------------------------------------------------------------
alter table public.llm_calls drop constraint if exists llm_calls_project_id_fkey;
alter table public.llm_calls
  add constraint llm_calls_project_id_fkey
  foreign key (project_id) references public.projects (id) on delete set null;

alter table public.usage_events drop constraint if exists usage_events_project_id_fkey;
alter table public.usage_events
  add constraint usage_events_project_id_fkey
  foreign key (project_id) references public.projects (id) on delete set null;
