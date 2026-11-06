# Deploying Legiit Ai Info

Three services: Supabase (database, auth, storage), Vercel (the app), Anthropic
(extraction and writing). Stripe arrives in slice 5.

## 1. Supabase

The project exists: "Legiit Ai Info", ref `nitzqpumgpwfqphlygyp`, us-east-1,
PostgreSQL 17. On 2026-11-06 both migrations were applied to it and recorded in
`supabase_migrations.schema_migrations`, so `supabase db push` sees them as
applied, and `pnpm e2e:supabase` passes against it. Its URL and keys are in
`.env.local` on the machine that set it up; they are also under Project
Settings > API Keys in the dashboard. The steps below are for a new project.

1. Create a project. Note the project URL, the publishable (or anon) key, and the
   secret (or service_role) key from Project Settings > API.
2. Apply every file in `supabase/migrations` in order, in the SQL editor or with
   `supabase db push`. `0001_init.sql` creates every table with RLS, the trigger
   that makes a `profiles` row for each new auth user, and the private
   `crawl-html` and `exports` storage buckets. `0002_tighten_rls.sql` is not
   optional: it revokes writes from the browser key, without which a signed-in
   user could set their own plan to paid. `pnpm db:check` runs the same
   migrations and the RLS checks against a local PostgreSQL, and
   `pnpm e2e:supabase` runs a whole scan against the project (see CLAUDE.md).
3. Authentication > URL Configuration: set the Site URL to the app's origin and
   add `https://<your-domain>/auth/callback?*` and
   `http://localhost:3000/auth/callback?*` to the redirect allow-list. The magic
   link carries `?next=`, so the wildcard matters. The existing project allows
   `http://localhost:3000` and `https://legiitaiinfo.com`; add the Vercel URL
   when it is known, and nothing wider (a wildcard over `vercel.app` would let
   a magic link land on someone else's site).
4. Authentication > SMTP Settings: set up a mail provider before launch. The
   built-in email service sends 2 emails an hour per project, so magic links
   stop arriving after the second sign-in in an hour.
5. Authentication > Providers: Email is on by default (magic link needs no
   password). For Google, create an OAuth client in Google Cloud with the
   Supabase callback URL shown in the provider settings, paste the client id and
   secret, then set `NEXT_PUBLIC_GOOGLE_AUTH=1` on the app so the button shows.
6. Authentication > Email templates: the default "Magic Link" template works.
   Keep `{{ .ConfirmationURL }}` in it.

## 2. Vercel

The project exists: `legiit-ai-info` on the team account, linked to the GitHub
repository with `main` as its production branch. On 2026-11-06 its framework
was set to Next.js, the eight variables below were set for production,
preview, and development, and the branch `claude/friendly-heisenberg-q66yrv`
was deployed as production through the API, at
https://legiit-ai-info.vercel.app. `main` holds only the examples folder, so
until the branch is merged into `main`, a push to `main` would replace the
site with an empty build; a push to the branch only makes a preview
deployment. The steps below are for a new project.

1. Import the repository. Framework: Next.js. Package manager: pnpm (detected
   from the lockfile).
2. Environment variables (see `.env.example`):
   - `NEXT_PUBLIC_SITE_URL` the production origin, no trailing slash
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `ANTHROPIC_API_KEY`
   - `ADMIN_EMAILS` comma-separated
   - `PLAN_PRICE_USD` (slice 5 reads it; set it now so the pricing section is right)
3. The step route exports `maxDuration = 60`. On the Hobby plan this needs Fluid
   Compute, which is on by default for new projects. Each step stops starting
   work after 20 seconds and the lock lease is 70 seconds, so a function killed at
   the ceiling cannot overlap the retry.
4. Deploy. `/api/health` answers `{ ok: true }`.

Usage caps arrive in slice 5. Until then any signed-in account can start scans
without a limit, and each scan spends Haiku tokens on up to 40 pages. Keep the
site unlisted, or watch `llm_calls`, until the caps ship.

## 3. First run checklist

What `pnpm e2e:supabase` already proves on the project: auth users get a
profile row, every query the scan makes runs on PostgREST, HTML lands in the
private bucket and stays private, the browser key reads only its owner's rows
and writes none of them, and concurrent edits and racing steps behave. What it
does not: the magic-link email itself, and a scan with the real model (it uses
a stand-in for the Anthropic API). The checklist covers those.

1. Open the site, enter a URL in the hero, sign in with the magic link, and watch
   the scan on the project page.
2. In Supabase, check `crawl_runs.log` for the run: discovery line, "Read N
   pages" lines, "Fact sheet ready".
3. Check `llm_calls` has one row per extracted page with tokens and cost, and
   that `crawl_runs.cost_usd` is their sum.
4. Open a conflict on the review screen, pick a candidate, and confirm the field
   flips to "You provided this" and `fact_sheets.data` changed.
5. Check Storage > crawl-html has `<project>/<run>/<page>.html` objects.

## Running locally

```bash
cp .env.example .env.local   # fill in the values above
pnpm install
pnpm dev
```

`/dev/review` renders the review screen from the Legiit fixture without a
database. It returns 404 in production.
