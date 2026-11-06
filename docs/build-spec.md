# Build spec: slices 2 to 6

Everything after the fact sheet. Read this with `PLAN.md` (architecture, slices)
and `CLAUDE.md` (conventions). The two example pages in `examples/` set the bar:
`legiit-about-page.html` with `legiit-schema.html`, and the counselling example.
Open them before writing anything that produces a page or schema.

## Module contracts (fixed; builders implement, nobody renames)

All under `src/lib/generate/` unless noted. Types in `src/lib/generate/types.ts`.

| Module | Export | Does |
|---|---|---|
| `prompt.ts` | `WRITING_RULES`, `buildWriterSystemPrompt(spec)`, `buildWriterUserPrompt({spec, data, siteUrl, companyName, part, draft?})`, `buildRewritePrompt({spec, data, draft, report})` | The Sonnet prompts. The user prompt carries the fact sheet as compact JSON of found and user-provided fields only, with each list item and evidence quote, and the list of missing and conflicting fields so the writer knows what not to invent. |
| `schema.ts` | `DraftMainSchema`, `DraftFaqSchema`, `DraftFullSchema` (zod), `draftFromMain(out)`, `draftWithFaq(draft, out)`, `draftFromFull(out)` | Structured output shapes for the three calls and their conversion to `PageDraft`. Closed objects, every property required (empty string or array for none). |
| `writer.ts` | `writeMain(input)`, `writeFaq(input)`, `rewriteDraft(input)` returning `WriterResult` | The three model calls through `callStructured` with `config.models.write`, `config.generate.maxOutputTokens`, `timeoutMs: config.generate.timeoutMs`, `effort: config.generate.effort`, `cacheSystem: true`, purpose `write_page`, `write_faq`, `rewrite_page`. |
| `lint.ts` | `BANNED`, `lintDraft(draft, data, spec)` returning `LintReport` | Deterministic. Pure. Fast. |
| `keyfacts.ts` | `keyFactsRows(spec, data)` returning `KeyFactRow[]` | The Key facts table from `spec.keyFactsRows`: for each row the first `from` field that has a value, formatted for people (lists joined; pricing items as "name: price (notes)"; addresses on one line; links as `<a>`). Rows with nothing are left out. |
| `jsonld.ts` | `buildJsonLd({spec, data, draft, siteUrl, pageUrl})` returning the `@graph` object | See Schema below. |
| `render.ts` | `renderPageHtml(input)`, `renderWordpressHtml(input)` with `RenderInput = {draft, keyFacts, jsonld, companyName, pageUrl, siteUrl}` | See Page HTML below. |
| `instructions.ts` | `buildInstructions({platform, companyName, existingSchema, data, pageUrl})` returning markdown | See Instructions below. |
| `zip.ts` | `buildZip(files)` returning `Uint8Array` | fflate. Files: `about.html`, `about-wordpress.html`, `schema.json`, `instructions.md`, `fact-sheet.json`. |
| `db.ts` | queries for generations and share links (service client) | Mirrors `src/lib/runs/db.ts` style: `must`/`maybe`, `DbError`. |
| `view.ts` | `GenerationView`, `generationViewFromRow(row)` | Status, phase, progress 0..1, one-line message, flags for which outputs exist, cost. Pure; tested. |
| `step.ts` | `stepGeneration(generationId, userId)` returning `{locked: boolean; generation: GenerationView}` | The stepped job. See Generation job below. |
| `src/lib/billing/caps.ts` | `checkAllowance(db, user, kind, projectId?)` returning `Allowance` | See Caps below. |
| `src/lib/billing/usage.ts` | `monthlyProjects(db, userId)`, `crawlsForProject(db, projectId)`, `generationsForProject(db, projectId)` | Counts from `usage_events`. |
| `src/lib/billing/stripe.ts` | `getStripe()`, `isBillingConfigured()`, `priceId()` | Lazy Stripe client from `STRIPE_SECRET_KEY`; `isBillingConfigured()` false without `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID`. |

Every function that reads the database takes the service client (`Db` from
`src/lib/runs/db.ts`) and is called only from route handlers that checked
ownership, or from server components that pass the session client for reads.

## The page draft

`PageDraft` (in `types.ts`) is the single source of truth the page, the
WordPress HTML, and the schema are rendered from. The model writes the draft;
the key facts table and the schema are built from the fact sheet by code, never
by the model, so nothing in them can be invented.

Sections, in order, with the template's headings (`[COMPANY]` replaced):

1. H1 `title` ("About Legiit"), then `intro`: two or three paragraphs. First
   sentence: what the company is, from `category` and `core_offering`. Then
   founded, size, mission where known.
2. "What [COMPANY] does": `offerings`, one H3 per service or product, two or
   three sentences each, prices where the fact sheet gives them.
3. "What makes [COMPANY] different": `differentiators`, about five H3s, each
   specific and, where the facts allow, quantified; competitors named where the
   fact sheet names them; awards, track record, notable clients live here. The
   founder quote, if there is one, goes here as a blockquote (`paragraphs`
   entry starting with `> `).
4. "Who uses [COMPANY]": `customers`, a bullet list of exact segments.
5. "The team behind [COMPANY]": `founders` (H3 "Name, Title", two sentences of
   backstory, then their profile links as a line of links), `originStory`
   ("How [COMPANY] started"), `team` (H3 "Name, Role"), `teamSummary` ("The
   team": size and composition).
6. "How [COMPANY] works": `process`: channels, response time, who the customer
   works with, turnaround, onboarding, policies.
7. "Key facts": built by code from `keyFactsRows`.
8. "Frequently asked questions": `faq`, 10 to 12 questions, each answered in 2
   or 3 sentences, taken from `existing_faqs` first and then from facts the
   page states. The schema repeats them word for word.
9. `closing`: one or two short lines.

`stillToFill`: the ids of required fields the page could not cover because
they are missing. Shown to the owner as "Still to fill" with the field's
question, and as an HTML comment in the page where the content would go.

Everything the writer says must come from the fact sheet. A number not in the
fact sheet is an error the linter catches. Conflicting fields: use the value
the owner picked (status `user_provided`), else the merged value, never a
candidate.

## Writing rules (the linter enforces the mechanical ones)

- Plain words. Say what the business does and for whom. No marketing voice.
- Open on the point: the first sentence of every paragraph states the fact.
- Third person, by name ("Legiit vets freelancers"). No "we" outside a quote.
- No em dashes or en dashes used as dashes. Commas, colons, or full stops.
- No buzzwords. The banned list is `BANNED` in `lint.ts`; it includes at least:
  leverage, leveraging, cutting-edge, state-of-the-art, world-class,
  best-in-class, seamless, seamlessly, unlock, unleash, empower, empowering,
  elevate, synergy, synergies, game-changing, game changer, robust,
  innovative, innovation, passionate, passion, delve, tapestry, testament,
  holistic, transformative, transformational, journey, safe space, nurturing,
  bespoke, curated (except in a quote or a name), revolutionary, disruptive,
  next-level, supercharge, turbocharge, streamline, frictionless, effortless,
  thrilled, excited, dream, vibrant, dynamic, top-notch, top notch, premier,
  premium quality, unparalleled, unmatched, exceptional, outstanding,
  look no further, in today's fast-paced world, at the end of the day,
  we pride ourselves, we understand, whether you're, rest assured, needless to
  say, it's no secret, in a nutshell, the bottom line, comprehensive solution,
  one-stop shop, tailored to your needs, take your business to the next level.
  A field's `allowlist` exempts those words in that field's text (a modality a
  counselling practice really offers).
- No exclamation marks. No rhetorical questions in body text.
- Sentences under about 30 words; the linter flags over 40.
- Every number in the page (digits) must appear in the fact sheet's values or
  quotes, except years inside dates already there, and the FAQ count.
- No placeholders: "[insert", "TBD", "lorem", "XXX".
- FAQ: 10 to 12 questions; answers of 2 to 3 sentences.
- No empty section when the facts exist; a section with no facts is left out
  of the page (not written around).

## Generation job

Table `generations` (migration 0003 adds `draft`, `cursor`, `log`, `locked_at`,
`lock_token`, `attempts`, `title`, `meta_description`, `platform`, `page_url`).
Status enum: queued, writing, linting, done, failed.

`POST /api/projects/[id]/generations` (route owned by the core builder):
verify user, own project, a fact sheet exists, `checkAllowance(..., "generation",
projectId)`; insert the generation (version = max + 1, fact_sheet_id and
fact_sheet_version from the project's latest sheet, platform from the latest
run or project, page_url = site origin + `/about`), insert usage event
`generation_started`, set `project.latest_generation_id` and
`project.status = "generating"`. 201 `{generationId}`.

`POST /api/generations/[id]/step` (`export const maxDuration = 300`): one step.
Lock with `locked_at`/`lock_token` and a lease of `config.generate.lockLeaseMs`;
write `attempts` before work; fail after `config.generate.maxStepAttempts`.
Steps, each one bounded model call at most:

1. `writing` part `main`: `writeMain` → store `draft` (faq empty), tokens, cost.
2. `writing` part `faq`: `writeFaq` → store the full draft.
3. `linting`: `lintDraft`. If it passes, or `cursor.lintAttempts >=
   config.generate.lintAttempts`, go to finish with the report stored in
   `lint_report`. Otherwise `rewriteDraft` with the report, store, lintAttempts
   + 1, and stay in `linting` (the next step lints again).
4. finish: `keyFactsRows`, `buildJsonLd`, `renderPageHtml`,
   `renderWordpressHtml`, `buildInstructions`; write `page_html`,
   `wordpress_html`, `schema`, `instructions_md`, `still_to_fill`, `title`,
   `meta_description`, status `done`; `project.status = "ready"`,
   `project.latest_generation_id`. Cost = sum of `llm_calls` for the
   generation.

Every model call goes through `callStructured` with `ctx.generationId` so it
lands in `llm_calls`. A failed step records the error on the generation and
returns; the client steps again; the attempt counter ends it.

`GET /api/generations/[id]`: `{generation: GenerationView}`.
`GET /api/generations/[id]/zip`: the zip, `content-disposition: attachment`.
`GET /api/generations/[id]/html`: `page_html` as `text/html` (for "open in a tab").
`POST /api/generations/[id]/share`: makes (or returns the existing) share link
token, 30 days; `{url}`. `DELETE` revokes.
`GET /s/[token]` (`src/app/s/[token]/route.ts`): the page HTML, public, no
auth, service client by token, 404 when missing or expired, `X-Robots-Tag:
noindex`.

Client: `src/lib/generate/api.ts` mirrors `src/lib/projects/api.ts`
(`startGeneration`, `stepGeneration`, `getGeneration`, `createShareLink`).
The progress component mirrors `src/components/app/run/run-progress.tsx`.

## Page HTML

`renderPageHtml` produces a standalone page like `examples/legiit-about-page.html`:
doctype, `<title>` = `metaTitle`, meta description, canonical = `pageUrl`, the
JSON-LD script with the comment above it, the preview `<style>` block with
the comment that it is preview only, then `<main><article>` with the sections
in order, the Key facts `<table>` (`<th scope="row">`), the FAQ as H3 + P
pairs, the closing lines. HTML-escape everything from the draft and the fact
sheet. Links from the fact sheet (`url` keys, social profiles) rendered as
`<a href>`. Where `stillToFill` has a field whose section is on the page, an
HTML comment `<!-- Still to fill: <question> -->` goes where it belongs.

`renderWordpressHtml` is the same article's inner HTML (no doctype, head,
style, or main), with the JSON-LD script first, for pasting into a Custom HTML
block.

## Schema

`buildJsonLd` returns `{"@context": "https://schema.org", "@graph": [org, page]}`
like the examples:

- `org`: `@type` from `business_type` (one of `spec.schema.orgTypes`; when it is
  in `localBusinessTypes`, `@type: [that, "LocalBusiness"]`; unknown values fall
  back to `Organization`). `@id` = site origin + `#organization`. `name`,
  `legalName`, `alternateName` (array), `url`, `logo`, `description` (the
  intro's first sentence), `foundingDate`, `founder` (Person: name, jobTitle,
  url, sameAs from the person's social keys), `employee` (team members),
  `numberOfEmployees` (QuantitativeValue from `team_size` when it has a
  number), `address` (PostalAddress), `geo` (from `geo` "lat, lng"), `hasMap`,
  `telephone`, `email`, `areaServed` (City entries), `openingHoursSpecification`
  (from `hours`: dayOfWeek arrays from the days text, opens/closes as "HH:MM"
  24-hour, using `clockReadings`/`daysNamed` in `src/lib/extract/normalize.ts`),
  `priceRange`, `sameAs` (business social profiles), `hasOfferCatalog` (Offer
  per pricing item with a parseable price; priceCurrency guessed from the
  symbol, USD default). Local-business-only properties (address, geo, hours,
  areaServed, priceRange) only when the type is a LocalBusiness subtype.
- `page`: `@type: ["AboutPage", "FAQPage"]`, `@id` = pageUrl + `#webpage`,
  `url`, `name` (metaTitle), `description`, `inLanguage: "en"`, `about: {"@id":
  org id}`, `mainEntity`: Question/Answer from `draft.faq`, word for word.
- Nothing without a value. No empty strings, arrays, or objects.

## Instructions

`buildInstructions` returns markdown with:

1. What is in the download and where each file goes.
2. Platform steps for `platform` (wordpress, shopify, wix, squarespace, webflow,
   other, unknown): where to make the page at `/about`, which editor block
   takes HTML (WordPress: Custom HTML block, or a page template; Shopify: Pages,
   Show HTML; Wix: Embed HTML or Velo; Squarespace: Code block, plus Code
   Injection for the schema; Webflow: Embed element, plus page settings head
   code; other: paste the article, add the script to the head). Each platform
   says where the JSON-LD goes when the editor strips `<script>` tags.
3. Existing schema notes: for each block in `existingSchema` whose values
   disagree with the fact sheet (name, telephone, address, url, sameAs), one
   line saying what the site's current block says, what the fact sheet says,
   and to remove or align it so the two do not contradict each other. Blocks
   that agree: one line saying they can stay.
4. How to check: paste the page URL into the Rich Results Test and the Schema
   Markup Validator; what to look for.
5. Keep the page honest: change a fact on the site, change it here too.

## Caps (slice 5)

`checkAllowance(db, user, kind, projectId?)`: admin emails (`isAdminEmail`)
are exempt. Else plan from `profiles.plan`, caps from `config.plans[plan]`:

- `project`: `monthlyProjects` (usage events `project_created` in the current
  UTC month) < `projectsPerMonth`.
- `crawl`: `crawlsForProject` (`crawl_started` for the project) < `crawlsPerProject`.
- `generation`: `generationsForProject` < `generationsPerProject`; 0 means "the
  free plan does not include page generation".

Returns `{ok: true, used, limit}` or `{ok: false, used, limit, message}` with
a plain message naming the limit and the plan. Routes answer 402 with the
message. The account page and the new-project page show used/limit.

## Billing (slice 5)

Stripe, only when configured (`STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`,
`STRIPE_WEBHOOK_SECRET`); otherwise the account page says billing is not set
up and shows the support email, and the pricing page CTA goes to the login.

- `POST /api/billing/checkout`: Checkout Session, mode subscription, the price,
  customer = the profile's `stripe_customer_id` (made on first use with the
  email), success and cancel URLs on `/account`, `client_reference_id` =
  user id. `{url}`.
- `POST /api/billing/portal`: Billing Portal session for the customer. `{url}`.
- `POST /api/billing/webhook`: raw body, `stripe.webhooks.constructEvent`.
  `checkout.session.completed` → plan paid, customer and subscription ids,
  `plan_updated_at`. `customer.subscription.updated` with status active →
  paid; `customer.subscription.deleted` or status canceled/unpaid → free unless
  the user has a redeemed access code (then sponsored). Idempotent.
- Access codes: `POST /api/access-codes/redeem` `{code}` → checks exists, not
  expired, uses < max_uses, not already redeemed by this user; inserts the
  redemption, increments uses, sets plan sponsored. Admin: `GET/POST
  /api/admin/access-codes` (list; create with label, max_uses, expires_at;
  code = 12 upper-case letters and digits without 0/O/1/I).

## Admin (slice 5)

`src/app/admin/*`, gated by `requireAdmin()` in the layout:

- `/admin`: cost dashboard: totals (spend, calls, users, projects,
  generations) for 7, 30, 90 days; spend by day (table), by purpose, by model;
  top projects by spend; failed calls count. Reads `llm_calls` with the
  service client.
- `/admin/users`: email, plan, projects, spend, joined.
- `/admin/access-codes`: list and a create form.
- `/admin/projects`: site, owner, status, runs, generations, spend.

## Manual mode and the question flow (slice 2)

- `POST /api/projects` accepts `{siteUrl, mode?: "crawl" | "manual"}`. Manual:
  insert the project with mode manual and status review, a fact sheet version 1
  with every field `missing` (`emptyField`) and source `manual`, no run. The
  new-project form's "Fill it in by hand instead" starts manual mode (it still
  needs the website address, for the canonical URL and the schema).
- Question flow: `src/components/app/review/question-flow.tsx`, opened from the
  review summary's "Fill the gaps" button: a dialog that walks the missing
  fields (required first, in section order) one at a time with the field's
  question, the existing `FieldEditor`, Skip and Save, a progress line "3 of
  11", and closes at the end. Saves through `patchFactSheet`.

## UI (slice 3 and 6)

- Project page: the "Generate the page" button is real. With a fact sheet:
  enabled; starts a generation and routes to `/app/projects/[id]/page`. With a
  generation in progress: the progress component. With a finished one: a card
  with the title, when it was made, the cost, and buttons Open, Download zip,
  Share, Generate again. Required fields missing: a warning listing them with
  "Generate anyway" (the page leaves notes) and "Fill the gaps".
- `/app/projects/[id]/page`: tabs Preview (iframe with `srcdoc`), Page HTML,
  WordPress HTML, Schema, Instructions, Still to fill (questions with an
  Answer link back to the review screen), Lint (issues that remain). Copy
  buttons on code tabs; Download zip; Share link (create, copy, revoke).
- Account page: plan, allowance used/limit for the three caps, Upgrade
  (Checkout) or Manage billing (Portal), Redeem an access code form.
- Remove every "next release" placeholder.

## Testing

- Unit tests for lint, keyfacts, jsonld, render, instructions, view, caps
  logic, access code format, with the Legiit fixture
  (`examples/fixtures/legiit.factsheet.json`) as the main input. Compare the
  schema built from the fixture with `examples/legiit-schema.html`: same
  types, same `@id`s, same founders, employees, sameAs; differences only where
  the fixture lacks a value.
- The e2e fake model (`scripts/e2e/fakes.ts`) must answer the writer calls:
  detect `write_page` / `write_faq` / `rewrite_page` from the system prompt's
  first line and return a draft built from the roofing site's facts, with one
  banned word in the first draft so the lint-rewrite path runs once.
- `pnpm e2e:local` and `pnpm e2e:supabase` gain: start a generation, step to
  done, assert page_html contains the company name and the FAQ, schema has
  Organization and FAQPage, instructions name the platform, zip downloads,
  share link serves the page and 404s after revoke, another user gets 404s.

## File ownership (builders run in parallel; stay in your files)

- writer: `src/lib/generate/prompt.ts`, `schema.ts`, `writer.ts`, their tests.
- lint: `src/lib/generate/lint.ts`, its test.
- schema+render: `src/lib/generate/keyfacts.ts`, `jsonld.ts`, `render.ts`, tests.
- outputs: `src/lib/generate/instructions.ts`, `zip.ts`, tests; routes
  `/api/generations/[id]/zip`, `/share`, `/html`; `src/app/s/[token]/route.ts`.
- core: `src/lib/generate/db.ts`, `view.ts`, `step.ts`, `api.ts`; routes
  `/api/projects/[id]/generations`, `/api/generations/[id]`, `/step`;
  `src/components/app/generate/*`; `src/app/app/projects/[id]/page/page.tsx`;
  the project page's generation card and button.
- billing: `src/lib/billing/*`, `/api/billing/*`, `/api/access-codes/*`,
  `/api/admin/*`, `src/app/admin/*`, the account page, the pricing CTA, the
  cap check in `/api/projects/[id]/runs`.
- manual: `/api/projects/route.ts` (manual mode and the project cap check),
  the new-project form, `question-flow.tsx`, the review summary button.
- e2e: `scripts/e2e/*`, docs.
