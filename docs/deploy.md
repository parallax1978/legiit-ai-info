# Deploying Legiit Ai Info

Three services: Supabase (database, auth, storage), Vercel (the app), Anthropic
(extraction and writing). Stripe arrives in slice 5.

## 1. Supabase

1. Create a project. Note the project URL, the publishable (or anon) key, and the
   secret (or service_role) key from Project Settings > API.
2. Apply `supabase/migrations/0001_init.sql` in the SQL editor (or `supabase db
   push` with the CLI). It creates every table with RLS, the trigger that makes a
   `profiles` row for each new auth user, and the private `crawl-html` and
   `exports` storage buckets.
3. Authentication > URL Configuration: set the Site URL to the app's origin and
   add `https://<your-domain>/auth/callback?*` and
   `http://localhost:3000/auth/callback?*` to the redirect allow-list. The magic
   link carries `?next=`, so the wildcard matters.
4. Authentication > Providers: Email is on by default (magic link needs no
   password). For Google, create an OAuth client in Google Cloud with the
   Supabase callback URL shown in the provider settings, paste the client id and
   secret, then set `NEXT_PUBLIC_GOOGLE_AUTH=1` on the app so the button shows.
5. Authentication > Email templates: the default "Magic Link" template works.
   Keep `{{ .ConfirmationURL }}` in it.

## 2. Vercel

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

## 3. First run checklist

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

`/dev/review` renders the review screen from the Darcy Bailey fixture without a
database. It returns 404 in production.
