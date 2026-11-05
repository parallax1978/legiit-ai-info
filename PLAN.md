# Legiit Ai Info: build plan

Legiit Ai Info turns a business website into an AI-ready About page: a fact sheet with
evidence, a review screen that shows what is found, missing, and contradicted, and then
the page, the JSON-LD, and install instructions. The two manual runs in `examples/`
(Legiit and Darcy Bailey & Associates Counselling) are the quality bar.

This file is the plan. `CLAUDE.md` carries conventions, commands, and running decisions.

## Questions, and the assumptions the build runs on until answered

Nothing below blocks slice 1. Each has a default that is one config value or one
redirect away from the other answer.

1. **Domain.** The product is built as `legiitaiinfo.com` (canonical URLs, Open Graph
   tags, the crawler's User-Agent `LegiitAiInfoBot`). Set `NEXT_PUBLIC_SITE_URL` if it
   is something else.
2. **Plan shape.** One paid plan, billed monthly, because Customer Portal cancellation
   implies a subscription. The price is `PLAN_PRICE_USD` in `src/config.ts` (placeholder
   until the cost dashboard gives a real number). If you want a one-time purchase
   instead, Stripe Checkout mode changes from `subscription` to `payment`.
3. **Sponsored users.** Access-code redemptions get the same caps as paid users. Caps
   are per plan in `src/config.ts`, so a separate `sponsored` cap is one line.
4. **Google sign-in.** Magic link works with nothing but Supabase. Google needs an OAuth
   client in Google Cloud added to the Supabase Auth provider settings; the button is
   built and hidden behind `NEXT_PUBLIC_GOOGLE_AUTH=1` until that is done.
5. **Raw HTML retention.** Crawled HTML is kept in a private Storage bucket for re-runs
   with no expiry. If storage cost matters, a retention sweep is a small cron job.

## Stack

- Next.js 16 (App Router, TypeScript, `src/`), Tailwind v4 with the Legiit tokens as
  theme variables, shadcn/ui mapped to those tokens, lucide icons. Deployed on Vercel.
- Supabase: Postgres, Auth (magic link, Google), Storage (`crawl-html` for raw pages,
  `exports` for zips). RLS on every table. Service role key only in server code.
- Anthropic API: `claude-haiku-5-5` for per-page extraction, `claude-sonnet-5-5` for
  writing the page. Both IDs confirmed on platform.claude.com on 2026-11-05 and kept in
  `src/config.ts` with their prices.
- Stripe Checkout, Customer Portal, webhooks (slice 5).
- Vitest for tests. pnpm.

## Design tokens

Pulled from the live CSS of legiitkeywords.com and legiitcopy.com (both Tailwind v4,
Inter Variable, same custom theme), and the legiitleads.com icon. Verified values:

- `--color-brand #8a12dc`, `brand-strong #6e0db1`, `brand-soft #e9d5ff`,
  `brand-faint #f3e8ff`, `ink #0f172a`, `ink-muted #64748b`, `ink-soft #94a3b8`,
  `line #e5e7eb`, `line-strong #d1d5db`, `surface #fff`, `surface-alt #f7f7fb`,
  `surface-sunken #f1f1f6`, `plum #12081f`, `good #15803d` / `good-soft #dcfce7`,
  `warn #b45309` / `warn-soft #fef3c7`, `bad #b91c1c` / `bad-soft #fee2e2`,
  `--radius-card .75rem`.
- `.brand-gradient` = `linear-gradient(135deg,#8a12dc,#1863dc)`.
- `.text-gradient` = `linear-gradient(90deg,#a855f7,#d946ef 55%,#ec4899)` clipped to text.
- `.hero-dark` = plum background with
  `radial-gradient(60% 80% at 50% 110%,#8a12dc73,#0000 70%)` and a 22px dot grid
  `radial-gradient(#ffffff0f 1px,#0000 0)`.
- `.eyebrow` = 11px, uppercase, `.18em` tracking, weight 600.
- `shadow-glow 0 8px 24px -8px #8a12dc99`, `shadow-pop 0 8px 30px #0f172a1f, 0 2px 6px
  #0f172a0f`, `shadow-card 0 1px 2px #0f172a0a, 0 1px 3px #0f172a0f`.
- Dark mode (legiitcopy.com): background plum, card `#1a0f2e`, border `#2f2145`,
  muted `#b4a7c9`, primary `#a855f7`.
- Header, pricing cards, FAQ list, and footer markup copied structurally from
  legiitkeywords.com. The icon is the legiitleads.com style (gradient rounded square,
  white lucide glyph); this product uses `scan-search`.

## Data model

All tables have `created_at`, RLS enabled, and owner policies on `user_id`.

| Table | Purpose |
|---|---|
| `profiles` | one per auth user: email, plan (`free`, `paid`, `sponsored`), `stripe_customer_id`, `is_admin` is derived from `ADMIN_EMAILS` at request time, not stored |
| `access_codes` | code, label, max_uses, uses, expires_at, created_by; redeeming sets plan `sponsored` |
| `access_code_redemptions` | who redeemed what, when |
| `templates` | id (`about-v1`), version, spec jsonb; seeded from `src/templates/about-v1.ts` |
| `projects` | user_id, site_url, business_name, platform, template_id, status, mode (`crawl`, `manual`) |
| `crawl_runs` | per project: status, phase (`discover`, `fetch`, `extract`, `merge`, `done`, `failed`), counters, `cursor` jsonb (the step state), lock fields, error |
| `crawl_pages` | per run per URL: status, fetched_at, title, meta description, canonical, lang, text, text_chars, `html_path` in Storage, `jsonld` jsonb, `links` jsonb (tel, mailto, social, maps, reviews), `images` jsonb (logo and award candidates), `findings` jsonb (per-page extraction output), extraction tokens and cost |
| `fact_sheets` | per project, versioned: `data` jsonb keyed by field id, `source` (`crawl`, `manual`), `crawl_run_id` |
| `generations` | per project, versioned: page_html, wordpress_html, schema jsonb, instructions_md, still_to_fill jsonb, lint_report jsonb, fact_sheet_version, model, tokens, cost (slice 3) |
| `llm_calls` | every call: project_id, run_id, purpose, model, input/output/cache tokens, cost_usd, duration_ms, ok, error |
| `share_links` | token, project_id, generation_id, expires_at (slice 3) |
| `usage_events` | project created, crawl started, generation started, for caps (slice 5) |

A fact sheet field value looks like:

```json
{
  "value": "604-533-9163",
  "status": "found",
  "evidence": [{ "quote": "Call 604-533-9163", "url": "https://.../contact/", "source": "page" }],
  "candidates": [
    { "value": "$195", "evidence": [{ "quote": "...", "url": "..." }] },
    { "value": "$185", "evidence": [{ "quote": "...", "url": "..." }] }
  ],
  "derived": false
}
```

`status` is `found`, `missing`, `conflict`, or `user_provided`. `candidates` exists only
for conflicts. `derived` marks a value the tool constructed (a profile URL built from a
handle) rather than found, because the Legiit run showed those need a flag.

## Long jobs on Vercel

No queue service. Every long job is a state machine in Postgres (`crawl_runs.phase` +
`cursor`), and `POST /api/runs/[id]/step` performs one bounded slice of work:

- `discover`: robots.txt, sitemaps, URL ranking. One step.
- `fetch`: up to 6 pages in parallel per step, 10 s timeout each, 20 s budget per step.
- `extract`: up to 4 pages per step through Haiku, with the quote-check on every value.
- `merge`: one step. Writes the fact sheet version.

Each step exports `maxDuration = 60` and stops itself at 20 s, so it fits inside both
the old 10 s/60 s and the Fluid Compute limits on Vercel's Hobby and Pro plans. The
browser drives the loop: call `step`, render progress from the response, call again.
A lock column (`locked_at`, 70 s lease, longer than the function ceiling) stops two
tabs stepping the same run, and a step that Vercel kills at the ceiling cannot
overlap the retry that follows it. If the
user closes the tab the run pauses and resumes from the cursor when they come back.

If background completion becomes a requirement (user closes the tab and expects the
run to finish), the cheapest option is Upstash QStash calling the same `step` endpoint
with a callback chain: free for 500 messages a day, then about $1 per 100,000 messages.
A 40-page crawl is roughly 20 messages. Vercel Cron (free, once a minute on Pro, once
a day on Hobby) can sweep stalled runs. Neither is needed for slice 1.

## The pipeline

1. **Discover.** Normalize the URL, fetch `robots.txt` (respect disallow for our UA
   and `*`), read `Sitemap:` lines plus `/sitemap.xml`, `/sitemap_index.xml`,
   `/wp-sitemap.xml`. Rank URLs: home first, then about, team, contact, FAQ, pricing,
   services, locations, by path pattern and link text. Without a sitemap, BFS from the
   home page using on-page links, same ranking. Cap 40 pages, 3 MB of text.
2. **Fetch and clean.** Before stripping, pull `application/ld+json` blocks (parse
   errors kept as a flag), `tel:` and `mailto:` links, outbound links to Facebook,
   Instagram, LinkedIn, YouTube, X, TikTok, Threads, Pinterest, Google Maps, Yelp,
   Trustpilot, G2, Capterra, Clutch, BBB, and image alt text and file names that look
   like logos or award badges. Then strip script, style, noscript, iframe, svg, nav,
   header, footer, aside, and cookie banners; keep headings as `#` lines and body text.
   Detect the platform from `meta[name=generator]` and asset paths. Raw HTML goes to
   Storage, text to Postgres.
3. **Extract.** One Haiku call per page with structured output: a list of
   `{field_id, value, quote, confidence}`. The server checks that every quote is a
   verbatim substring of the page text (whitespace-normalized); findings that fail are
   dropped and counted. JSON-LD, tel, mailto and social links are turned into findings
   deterministically with the raw value as the quote. Findings are stored per page.
4. **Merge.** Group findings by field. Scalar fields with one normalized value are
   `found`; with more than one, `conflict` with every candidate and its evidence. List
   fields (services, team, awards, social) are unioned and de-duplicated by normalized
   key; people whose names differ by a small edit distance (Ranasuirya / Ranasuriya) or
   who share a profile URL under different names are flagged as a conflict on that
   item. Fields with nothing are `missing` with their plain-language question.
5. **Review.** Grouped by template section with status counts, evidence with source
   links, pick-one for conflicts, inline editing, questions for missing fields.
   Everything typed is `user_provided`. Existing JSON-LD from the site is shown in its
   own panel with the conflicts against the fact sheet (slice 4 adds the removal note).
6. **Generate, lint, deliver** (slices 3 and 4): one Sonnet pass from the fact sheet
   and template spec produces page HTML, WordPress HTML, and schema from one source of
   truth; deterministic linter with two retries; outputs page, zip, share link,
   per-platform instructions.

## Cost model

Per run, recorded in `llm_calls` and summed on the project:

- Extraction: about 40 pages × ~6k input tokens × $0.10/M plus ~600 output tokens ×
  $0.50/M, roughly $0.04 a crawl on Haiku 5.5.
- Generation: ~12k input, ~6k output on Sonnet 5.5 at $2/$10 per million, about $0.08
  a page, up to three passes with lint rewrites, under $0.25.
- Haiku's prompt-length tier (prices rise over 100k tokens) is never hit because one
  page per call is capped at 60k characters.

The admin cost dashboard (slice 5) reads `llm_calls` and Stripe revenue to set the
price.

## Build slices

Each slice ends with tests green, `pnpm build` green, and a commit.

**Slice 1 (this session):** scaffold, tokens, shadcn mapping, header/footer, Supabase
auth (magic link, Google), migrations with RLS, template spec as data, crawler with
tests, extractor with quote check and merge tests, stepped run API, project screens,
review screen with evidence, conflicts, and questions.

**Slice 2:** manual mode (fact sheet from the form only), question flow for missing
fields as a guided list, re-run extraction on an existing crawl.

**Slice 3:** generator (Sonnet), linter with tests, schema builder with tests, outputs
page, zip download, share link, fixtures from `examples/`.

**Slice 4:** platform detection surfaced in the UI, per-platform instructions,
existing-schema conflict notes.

**Slice 5:** Stripe Checkout and Portal, webhooks, access codes, usage caps and the
allowance display, admin pages, cost dashboard.

**Slice 6:** landing page in full (hero, how it works, what you get, pricing, FAQ,
dark CTA band), empty states, error states, re-run, Open Graph image, polish.

## Tests

- `crawler/clean.test.ts`: nav and footer stripping, heading preservation, tel and
  mailto extraction, social link classification, JSON-LD parsing with a broken block,
  platform detection, logo and award image candidates.
- `crawler/rank.test.ts`: URL ranking and the sitemap index walk.
- `extract/merge.test.ts`: agreement, scalar conflict, list union, name-spelling
  conflict, missing fields, quote verification dropping unquoted values.
- `generate/lint.test.ts` and `generate/schema.test.ts` (slice 3) with the two example
  fact sheets in `examples/fixtures/` as inputs.
