# Legiit Ai Info

A small SaaS that turns a business website into an AI-ready About page: crawl,
fact sheet with evidence, review screen, then the page, the JSON-LD, and install
instructions. `PLAN.md` has the architecture and the build order. `examples/` has
the two hand-made runs that set the quality bar.

## Commands

```bash
pnpm dev          # Next.js dev server
pnpm build        # production build; must pass before a commit
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest run
pnpm db:check     # apply migrations to a local PostgreSQL and run the RLS checks (needs a running server, see below)
pnpm e2e:local    # the whole scan and page through the route handlers on a local PostgreSQL (same server as db:check)
pnpm e2e:supabase # the same run on the Supabase project whose URL and keys are in .env.local
E2E_DUMP=/tmp/lai-page pnpm e2e:local   # also keeps the page, the WordPress HTML, the schema, the draft, and the instructions the run made
SITES=https://a.com,https://b.com pnpm smoke:crawl   # live crawl, no database or model; writes smoke-crawl-report.txt
```

`pnpm smoke:crawl` runs discovery, fetch, cleaning, and platform detection on live
sites and lists the ranked queue with reasons plus the cleaned text of the top
pages. Use it after changing ranking or cleaning rules, or to see what a scan
will pick on a client's site before spending model tokens. Behind an HTTP proxy
set `CRAWLER_PROXY_URL` (development only and ignored in production; the proxy
resolves names itself, so the connect-time private-address check does not run).

Local migration check: start PostgreSQL 16 on port 54329 with trust auth, create a
database `lai`, then `pnpm db:check`. The harness in `supabase/test/harness.sql`
stands in for the `auth` and `storage` schemas Supabase manages.

The end-to-end run (`scripts/e2e/pipeline.e2e.ts`) drives a scan and a page of
a made-up roofing site through the real route handlers: create the project,
step the run to a fact sheet, edit it concurrently, re-run from stored pages,
hit the free plan's caps (402 on a third scan and on any page), race two steps
for the lock, then review the sheet and generate the page (the writer's three
calls, the lint and one rewrite, the key facts, the schema, the renderer, the
instructions), download the zip, open the page, share it and revoke the link,
and check that every generation route answers another user with 404. Every
query runs through supabase-js. The site and the Anthropic API are stand-ins in
both modes (`scripts/e2e/fakes.ts`): the model answers the extractor by pattern
and the writer with a draft built from the site's facts whose main draft
carries one banned word, so the rewrite path runs once. It tells the three
writer calls apart by the property names of the output schema in the request.
The session cookie is a mocked `requireApiUser`, because the handlers read
cookies through `next/headers`. The owner starts on the free plan; the run
asserts the caps, then sets the plan to sponsored through the service client.

- `pnpm e2e:local` recreates the database `lai_e2e` on the db:check server and
  applies every migration. `scripts/e2e/postgrest-lite.ts` stands in for
  PostgREST and Storage; it builds PostgREST's SQL, so constraint, enum, NULL,
  and timestamp behavior is PostgreSQL's own. When the app starts using a
  PostgREST feature it does not answer (embedding, RPC), it fails loudly.
- `pnpm e2e:supabase` runs the same file on the Supabase project in `.env.local`.
  PostgREST, Storage, Auth, and RLS are the real ones: the test users are auth
  users made with the admin API, and four more tests sign in with the
  publishable key and check what the browser can see and do (generations and
  share links included). The users' data from the last run is removed and
  their plan goes back to free before each run; the run's own data is left for
  the dashboard.

Run both after changing queries, migrations, policies, the run or generation
state machine, the caps, or route handlers. `scripts/e2e/backend.ts` is where a
mode starts.

## Layout

- `src/app` routes. `(marketing)` is the public site, `app/` is signed-in, `account/`
  is the plan, allowance, billing, and access-code page, `admin/` is gated to
  `ADMIN_EMAILS` (cost dashboard, users, access codes, projects), `api/` holds
  route handlers, and `s/[token]` serves a shared page to anyone, no sign-in.
- `src/components/ui` shadcn/ui (base-nova style) mapped to the Legiit tokens.
  `src/components/site` header, footer, logo. `src/components/app` product screens:
  `review/` the fact sheet and the question flow, `run/` scan progress,
  `generate/` the generate button, progress, card, page tabs, share dialog.
- `src/lib/crawler` discovery, fetching, cleaning, platform detection.
- `src/lib/extract` per-page extraction (Haiku), quote verification, merge and
  conflict logic.
- `src/lib/facts` fact sheet types and helpers; `manual.ts` the empty sheet and
  the question order.
- `src/lib/generate` the page: `prompt.ts`, `schema.ts`, `writer.ts` (the three
  Sonnet calls), `lint.ts`, `keyfacts.ts`, `jsonld.ts`, `render.ts`,
  `instructions.ts`, `zip.ts`, `step.ts` (the stepped job) with `db.ts` and
  `view.ts`, `share.ts` (share links and the output routes' reads), `api.ts`
  (the browser client).
- `src/lib/billing` `caps.ts` (`checkAllowance`), `usage.ts` (counts from
  `usage_events`), `stripe.ts` (Checkout, Portal, the webhook mapping),
  `access-codes.ts`, `admin.ts` (the dashboard aggregations).
- `src/lib/llm` Anthropic client wrapper; every call logs to `llm_calls`.
- `src/lib/supabase` browser, server (session), and service-role clients.
- `src/templates` the page spec as data (`about-v1`).
- `supabase/migrations` SQL, one file per change, applied in order. `0003` adds
  the generation job's columns (draft, cursor, lock, attempts, platform, page URL).
- `src/config.ts` every number: model IDs, prices, caps, plan price, crawl limits,
  the generation step's limits.
- `docs/build-spec.md` the module contracts for slices 2 to 6; `docs/deploy.md`
  the services and their settings.

## Conventions

- TypeScript strict. No `any` in new code; use `unknown` and narrow.
- Server code only may import `@/lib/supabase/service`, `@/lib/llm/client`, and
  `@/lib/auth` (they import `server-only`).
- Route handlers verify the user with the session client, check ownership, then
  may use the service client for writes.
- Long jobs are stepped: `POST /api/runs/[id]/step` does one bounded unit of
  work and returns the run. `export const maxDuration = 60` on those routes.
- Inside a step (src/lib/runs/step.ts): run writes go through `writeRun`, which
  is conditional on the lock token; page writes call `assertLease` first. The
  attempt counter is written before any work, so a step killed at the ceiling
  still counts. Work is rebuilt from the rows, never trusted from the cursor
  alone. No request starts after `config.crawl.stepDeadlineMs`.
- Every external fetch has a timeout (`AbortSignal.timeout`) and goes through
  `src/lib/crawler/fetch.ts`, which follows redirects by hand and checks every
  hop and the host's DNS addresses against `isPrivateHost` before requesting it.
- The session client only reads. Every write goes through a route handler that
  checks ownership and then uses the service client; migration 0002 revokes
  session-client writes so this cannot be bypassed with the publishable key.
  `pnpm db:check` runs `supabase/test/rls_check.sql`, which fails if a user can
  write their own plan, projects, or fact sheets.
- Every LLM call goes through `callStructured` so model, tokens, cost, and
  duration land in `llm_calls`.
- Never let the extractor set a field without a verbatim quote. The quote must be
  a substring of the page text after whitespace normalization or it is dropped.
- The page is written from the fact sheet and nothing else. The writer's three
  calls (`write_page`, `write_faq`, `rewrite_page`) share one system prompt that
  is a pure function of the template spec, so the prompt cache applies. The key
  facts table and the JSON-LD are built by code from the fact sheet, never by
  the model. The linter (`lintDraft`) is pure and is the arbiter: every number in
  a draft must be in the fact sheet's values or quotes, and a banned word, a
  dash, first person, or an exclamation mark fails the draft.
- Generation steps (`src/lib/generate/step.ts`): `POST /api/generations/[id]/step`
  does one model call at most (`main`, `faq`, `lint` with up to
  `config.generate.lintAttempts` rewrites, `finish`) and returns the view;
  `export const maxDuration = 300` there, the lock lease is 330 s, the attempt
  counter is written before any work, and every write is conditional on the
  lock token. A step that throws records the error and keeps the cursor; after
  `maxStepAttempts` the generation fails and the project goes back to review.
  Cost is the sum of `llm_calls` for the generation, so a billed call that
  failed counts too.
- Caps: every start route (`POST /api/projects`, `/api/projects/[id]/runs`,
  `/api/projects/[id]/generations`) calls `checkAllowance` before writing and
  answers 402 with the plan's message. Admin emails are exempt. Counts come
  from `usage_events`, which a deleted project leaves behind.
- The Stripe webhook (`POST /api/billing/webhook`) reads the raw body and checks
  the signature with `STRIPE_WEBHOOK_SECRET` before it reads anything else.
  Applying an event is idempotent and order-safe (`event.created` against
  `profiles.plan_updated_at`), and a database error answers 500 so Stripe
  retries. Billing routes answer 503 with a plain message when the keys are not
  set.
- Share links: one live link per generation, 30 days, served by `/s/[token]`
  with `X-Robots-Tag: noindex`, no caching, and a CSP that blocks scripts;
  `DELETE /api/generations/[id]/share` revokes every link of the generation.
- Tailwind: use the token utilities (`bg-brand`, `text-ink-muted`, `border-line`,
  `rounded-card`, `shadow-glow`, `shadow-pop`, `shadow-card`, `eyebrow`,
  `brand-gradient`, `text-gradient`, `hero-dark`). Do not introduce other colors.
- Buttons: `<Button variant="primary|secondary|ghost|outline|destructive|link|onDark">`
  with sizes `xs|sm|md|lg`. Primary and secondary are pills.
- Copy on screen follows the writing rules in PLAN.md: plain words, no em dashes,
  no buzzwords, open on the point.
- Commit in small steps with messages that say what changed.

## Decisions

- Cache Components (`cacheComponents`) is off. Every signed-in screen reads the
  session cookie, so the conventional dynamic rendering model fits better than
  wrapping every page in Suspense boundaries.
- pnpm, because Vercel detects it from the lockfile and the sibling sites use it.
- Raw HTML lives in the private `crawl-html` Storage bucket; extracted text in
  `crawl_pages.text`. Re-runs reuse stored pages.
- The template spec is TypeScript in `src/templates` and is also upserted into the
  `templates` table so the spec is data in the database too.
- Free plan: one project a month with two scans of it, no generation. Paid and
  sponsored share caps (10 projects a month, 5 scans and 10 pages per project).
  All in `src/config.ts`.
- Model IDs confirmed on platform.claude.com on 2026-11-05: `claude-haiku-5-5`
  for extraction, `claude-sonnet-5-5` for writing.
- Lock lease 70 s, longer than the 60 s function ceiling, so a killed step can
  never overlap the next one. A phase slice that is cut off five times in a row
  fails the run with a plain message instead of retrying forever. The
  generation step has the same shape with bigger numbers (300 s ceiling, 330 s
  lease, three attempts) because one Sonnet call can take minutes.
- A generation is written from the fact sheet the project pointed at when it
  started (`fact_sheet_id`, `fact_sheet_version`); editing the sheet afterwards
  marks the page stale on the screen rather than changing it.
- The free plan includes no page generation (`generationsPerProject: 0`), so
  the e2e run asserts the 402 and then sets the owner's plan to sponsored the
  way an access code would, through the service client.
- Without Stripe keys the product still runs: billing routes say so, the
  pricing CTA leads to the account page, and admins hand out access codes.
- A new scan keeps the owner's edits: every `user_provided` field on the
  project's last fact sheet (typed values, picked candidates, manual answers)
  carries onto the new sheet, with the scan's own result under `crawled` so
  "clear" restores it (`src/lib/facts/carry.ts`). Untouched fields take the
  new result.
- A failed re-run leaves a project that already has a fact sheet in review; only
  a project with nothing to fall back on is marked failed. Only a project's
  latest run moves its pointers.
- A run whose pages all failed extraction fails rather than producing an
  all-missing fact sheet. Pages whose model call failed still keep their
  JSON-LD, link, and canonical findings.
- Cost and usage history outlive a deleted project (`on delete set null`), so
  the cost dashboard stays complete and deleting a project does not hand back
  its monthly allowance.
- The wordmark renders as "Legiit" + "Ai Info" with no space before "Ai", the way
  legiitkeywords.com renders "LegiitKeywords". One character to change if wanted.
