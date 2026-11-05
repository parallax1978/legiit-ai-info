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
```

Local migration check: start PostgreSQL 16 on port 54329 with trust auth, create a
database `lai`, then `pnpm db:check`. The harness in `supabase/test/harness.sql`
stands in for the `auth` and `storage` schemas Supabase manages.

## Layout

- `src/app` routes. `(marketing)` is the public site, `app/` is signed-in, `admin/`
  is gated to `ADMIN_EMAILS`, `api/` holds route handlers.
- `src/components/ui` shadcn/ui (base-nova style) mapped to the Legiit tokens.
  `src/components/site` header, footer, logo. `src/components/app` product screens.
- `src/lib/crawler` discovery, fetching, cleaning, platform detection.
- `src/lib/extract` per-page extraction (Haiku), quote verification, merge and
  conflict logic.
- `src/lib/facts` fact sheet types and helpers.
- `src/lib/llm` Anthropic client wrapper; every call logs to `llm_calls`.
- `src/lib/supabase` browser, server (session), and service-role clients.
- `src/templates` the page spec as data (`about-v1`).
- `supabase/migrations` SQL, one file per change, applied in order.
- `src/config.ts` every number: model IDs, prices, caps, plan price, crawl limits.

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
- Free plan: one project a month with crawls, no generation. Paid and sponsored
  share caps. All in `src/config.ts`.
- Model IDs confirmed on platform.claude.com on 2026-11-05: `claude-haiku-5-5`
  for extraction, `claude-sonnet-5-5` for writing.
- Lock lease 70 s, longer than the 60 s function ceiling, so a killed step can
  never overlap the next one. A phase slice that is cut off five times in a row
  fails the run with a plain message instead of retrying forever.
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
