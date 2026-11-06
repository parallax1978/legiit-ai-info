# Deploying Legiit Ai Info

Four services: Supabase (database, auth, storage), Vercel (the app), Anthropic
(extraction and writing), and Stripe (billing). Stripe is optional: without its
keys the app runs with the free plan's caps, the account page says billing is
not set up, and admins hand out access codes instead.

## 1. Supabase

The project exists: "Legiit Ai Info", ref `nitzqpumgpwfqphlygyp`, us-east-1,
PostgreSQL 17. On 2026-11-06 all three migrations were applied to it and
recorded in `supabase_migrations.schema_migrations`, so `supabase db push` sees
them as applied, and `pnpm e2e:supabase` passes against it, the page generation
and the share link included. Its URL and keys are in `.env.local` on the
machine that set it up; they are also under Project Settings > API Keys in the
dashboard. The steps below are for a new project.

1. Create a project. Note the project URL, the publishable (or anon) key, and the
   secret (or service_role) key from Project Settings > API.
2. Apply every file in `supabase/migrations` in order, in the SQL editor or with
   `supabase db push`. `0001_init.sql` creates every table with RLS, the trigger
   that makes a `profiles` row for each new auth user, and the private
   `crawl-html` and `exports` storage buckets. `0002_tighten_rls.sql` is not
   optional: it revokes writes from the browser key, without which a signed-in
   user could set their own plan to paid. `0003_generations.sql` adds the
   columns the page generation job keeps on its row (draft, cursor, log, lock,
   attempts, title, meta description, platform, page URL); without it no page
   can be started. `pnpm db:check` runs the same migrations and the RLS checks
   against a local PostgreSQL, and `pnpm e2e:supabase` runs a whole scan and
   page against the project (see CLAUDE.md).
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
was set to Next.js, the first eight variables below were set for production,
preview, and development, and the branch `claude/friendly-heisenberg-q66yrv`
was deployed as production through the API, at
https://legiit-ai-info.vercel.app. The three Stripe variables are not set
there yet. `main` holds only the examples folder, so until the branch is
merged into `main`, a push to `main` would replace the site with an empty
build; a push to the branch only makes a preview deployment. The steps below
are for a new project.

1. Import the repository. Framework: Next.js. Package manager: pnpm (detected
   from the lockfile).
2. Environment variables (see `.env.example`):
   - `NEXT_PUBLIC_SITE_URL` the production origin, no trailing slash. Share
     links are built from it (`<origin>/s/<token>`), so it must be the origin
     people open.
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `ANTHROPIC_API_KEY`
   - `ADMIN_EMAILS` comma-separated. These accounts see `/admin` and are exempt
     from the plan caps.
   - `PLAN_PRICE_USD` what the pricing page shows; the amount Stripe charges is
     on the price in Stripe, so keep the two the same.
   - `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` from step 3
     below. Leave them unset until Stripe is ready; the app treats billing as
     not configured and says so.
3. The scan step route exports `maxDuration = 60` and the page generation step
   route `maxDuration = 300`. On the Hobby plan both need Fluid Compute, which
   is on by default for new projects and allows 300 seconds. A scan step stops
   starting work after 20 seconds with a 70 second lock lease; a generation
   step makes one model call with a 170 second timeout and a 330 second lease,
   so a function killed at either ceiling cannot overlap the retry.
4. Deploy. `/api/health` answers `{ ok: true }`.

The plan caps are live (`config.plans` in `src/config.ts`): the free plan gets
one project a month, two scans of it, and no page; paid and sponsored get ten
projects a month, five scans and ten pages per project. A scan spends Haiku
tokens on up to 40 pages and a page spends Sonnet tokens on three to five
calls; `/admin` shows the spend.

## 3. Stripe

Billing is one monthly subscription. Everything below is in the Stripe
dashboard; use test mode first, then repeat in live mode with live keys.

1. Products: create the product and a recurring monthly price. Its id
   (`price_...`) is `STRIPE_PRICE_ID`.
2. Developers > API keys: the secret key is `STRIPE_SECRET_KEY`.
3. Developers > Webhooks: add an endpoint at
   `https://<your-domain>/api/billing/webhook` subscribed to
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, and `customer.subscription.deleted`. Its
   signing secret (`whsec_...`) is `STRIPE_WEBHOOK_SECRET`. The handler checks
   the signature on the raw body before it reads anything, applies events in
   any order and more than once without harm, and answers 500 on a database
   error so Stripe retries.
4. Settings > Billing > Customer portal: turn the portal on and allow
   cancelling, so "Manage billing" on the account page works.
5. Set the three variables on Vercel and redeploy. The account page then shows
   Upgrade (Checkout) on the free plan and Manage billing (the Portal) on the
   paid plan, and the pricing page's button starts Checkout for a signed-in
   free user.

What happens on the app side: Checkout runs in subscription mode with the
profile's Stripe customer (made on first use from the email) and the user id as
`client_reference_id`; a completed checkout or a live subscription sets the plan
to paid with the customer and subscription ids; a deleted, cancelled, unpaid,
or paused subscription sets it back to free, or to sponsored when the user has
redeemed an access code.

Access codes need no Stripe: an admin makes them at `/admin/access-codes` (a
label, how many uses, an expiry), a user redeems one on the account page, and
the plan becomes sponsored with the paid plan's caps.

## 4. Admin

`ADMIN_EMAILS` gates four pages, each rendered with the service client after
`requireAdmin()`: `/admin` (spend, calls, users, projects, and pages for the
last 7, 30, and 90 days; spend by day, by purpose, by model; the top projects;
failed calls), `/admin/users`, `/admin/access-codes`, and `/admin/projects`.
Admin accounts are exempt from the caps, so keep the list short and use a
separate account to see what customers see.

## 5. First run checklist

What `pnpm e2e:supabase` already proves on the project: auth users get a
profile row, every query the scan and the page make runs on PostgREST, HTML
lands in the private bucket and stays private, the browser key reads only its
owner's rows (pages and share links included) and writes none of them, the
free plan's caps answer 402, concurrent edits and racing steps behave, the
page is written, linted, rewritten once, rendered, zipped, and shared, and the
share page stops at revocation. What it does not: the magic-link email itself,
a scan or a page with the real model (it uses a stand-in for the Anthropic
API), and Stripe. The checklist covers those.

1. Open the site, enter a URL in the hero, sign in with the magic link, and watch
   the scan on the project page.
2. In Supabase, check `crawl_runs.log` for the run: discovery line, "Read N
   pages" lines, "Fact sheet ready".
3. Check `llm_calls` has one row per extracted page with tokens and cost, and
   that `crawl_runs.cost_usd` is their sum.
4. Open a conflict on the review screen, pick a candidate, and confirm the field
   flips to "You provided this" and `fact_sheets.data` changed.
5. Check Storage > crawl-html has `<project>/<run>/<page>.html` objects.
6. On an account with a paid or sponsored plan (redeem an access code, or use
   an admin account), click Generate the page and watch the four steps. Check
   `generations` has the row with `page_html`, `schema`, `instructions_md`,
   and `lint_report`, and that `llm_calls` has rows with purposes `write_page`,
   `write_faq`, and (when the lint failed once) `rewrite_page` whose costs sum
   to `generations.cost_usd`.
7. Open the Preview, Schema, and Instructions tabs, download the zip, make a
   share link and open it in a private window, then revoke it and reload: the
   link must answer "This page is not available".
8. With Stripe in test mode: Upgrade on the account page, pay with the test
   card `4242 4242 4242 4242`, and check the webhook delivery in the Stripe
   dashboard answered 200 and `profiles.plan` is `paid`. Open Manage billing,
   cancel, and check the plan goes back to `free` (or `sponsored` with an
   access code). Repeat once in live mode with a real card before launch.

## Running locally

```bash
cp .env.example .env.local   # fill in the values above
pnpm install
pnpm dev
```

`/dev/review` renders the review screen from the Legiit fixture without a
database. It returns 404 in production. `E2E_DUMP=<dir> pnpm e2e:local` keeps
the page, the WordPress HTML, the schema, the draft, and the instructions the
end-to-end run makes from the stand-in site, for a look at the outputs without
a model key.
