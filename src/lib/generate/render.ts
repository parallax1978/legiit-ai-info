/*
  The page HTML and the WordPress HTML from one draft. The page is a standalone
  document like examples/legiit-about-page.html: head, the JSON-LD script, a
  preview style block, then main > article with the sections in the template's
  order. The WordPress HTML is the same article's inner HTML with the JSON-LD
  script first, for pasting into a Custom HTML block.

  Everything from the draft and the fact sheet is escaped. A link is rendered
  only with an http(s), mailto, or tel address. Section headings come from the
  about-v1 template with [COMPANY] filled in. Where a required field is still
  to fill, an HTML comment with its question goes in the section it belongs to.
*/
import { fillCompany, hostPath } from "@/lib/projects/view";
import { ABOUT_V1 } from "@/templates/about-v1";
import type { DraftItem, KeyFactRow, RenderInput } from "./types";

export const JSONLD_COMMENT =
  "Structured data. Organization + FAQPage, built only from facts on this page. Delete this block if you do not want it.";
export const STYLE_COMMENT = "Preview styling only. Drop this block and use the site's styles.";
export const KEY_FACTS_HEADING = "Key facts";

const PREVIEW_STYLE = `<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.55; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #111; }
  h1, h2, h3 { line-height: 1.25; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 0.5rem; border-bottom: 1px solid #ddd; }
  th { width: 11rem; }
  blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid #ccc; }
</style>`;

/** Headings for when the template has none for a section, so an H2 is never empty. */
const HEADING_FALLBACK: Record<string, string> = {
  offerings: "What [COMPANY] does",
  differentiators: "What makes [COMPANY] different",
  customers: "Who uses [COMPANY]",
  team: "The team behind [COMPANY]",
  process: "How [COMPANY] works",
  faq: "Frequently asked questions",
};

/** Where a still-to-fill comment goes, by the section of the field. Anything else goes at the end. */
type Placement = "intro" | "offerings" | "team" | "process" | "end";
const PLACEMENTS: Record<string, Placement> = {
  basics: "intro",
  offerings: "offerings",
  team: "team",
  process: "process",
};

// ---------------------------------------------------------------------------
// Text helpers, shared with the key facts and schema builders
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One line of text: whitespace collapsed, trimmed. Empty for anything that is not a string. */
export function oneLine(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * An address safe to put in a link: http(s), mailto, or tel. A bare host gets
 * https://. Anything else (javascript:, data:, text that is not a URL) is null,
 * and the caller renders the label as text instead.
 */
export function safeHref(url: string): string | null {
  const raw = oneLine(url);
  if (!raw) return null;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(raw) || /^tel:[+\d][\d\s().-]*$/i.test(raw)) return raw;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname.includes(".")) return null;
  return withScheme;
}

/** The JSON-LD script block. "</" and "<!--" inside values are escaped so no value can close the script. */
export function jsonLdScript(jsonld: Record<string, unknown>): string {
  const json = JSON.stringify(jsonld, null, 2).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\u0021--");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function sectionHeading(id: string, companyName: string): string {
  const raw = ABOUT_V1.sections.find((s) => s.id === id)?.heading || HEADING_FALLBACK[id] || id;
  return fillCompany(raw, companyName);
}

/**
 * Paragraphs as lines: one <p> each, and a run of paragraphs starting with
 * "> " as one <blockquote> of <p>s (returned as a single multi-line entry).
 */
function paragraphLines(texts: string[]): string[] {
  const out: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (quote.length) out.push(["<blockquote>", ...quote, "</blockquote>"].join("\n"));
    quote = [];
  };
  for (const raw of texts) {
    const t = oneLine(raw);
    if (!t) continue;
    if (t.startsWith(">")) {
      const body = oneLine(t.slice(1));
      if (body) quote.push(`<p>${escapeHtml(body)}</p>`);
      continue;
    }
    flush();
    out.push(`<p>${escapeHtml(t)}</p>`);
  }
  flush();
  return out;
}

/** "<p><a>Label</a>, <a>Label</a></p>", or null when no link has a safe address. */
function linksLine(links: DraftItem["links"]): string | null {
  const parts: string[] = [];
  for (const l of links ?? []) {
    const href = safeHref(l.url ?? "");
    if (!href) continue;
    const label = oneLine(l.label) || hostPath(href);
    if (!label) continue;
    parts.push(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
  }
  return parts.length ? `<p>${parts.join(", ")}</p>` : null;
}

/** An H3 item: heading, paragraphs, links line. One block; null when the item is empty. */
function itemBlock(item: DraftItem): string | null {
  const heading = oneLine(item.heading);
  const lines = paragraphLines(item.paragraphs ?? []);
  const links = linksLine(item.links);
  if (!heading && !lines.length) return null;
  const out: string[] = [];
  if (heading) out.push(`<h3>${escapeHtml(heading)}</h3>`);
  out.push(...lines);
  if (links) out.push(links);
  return out.join("\n");
}

function itemBlocks(items: DraftItem[]): string[] {
  return items.map(itemBlock).filter((b): b is string => b !== null);
}

/** An H3 with paragraphs under it, as one block; nothing when there are no paragraphs. */
function titledBlock(title: string, texts: string[]): string[] {
  const lines = paragraphLines(texts);
  return lines.length ? [[`<h3>${escapeHtml(title)}</h3>`, ...lines].join("\n")] : [];
}

function faqBlocks(faq: RenderInput["draft"]["faq"]): string[] {
  const out: string[] = [];
  for (const f of faq) {
    const q = oneLine(f.question);
    const a = oneLine(f.answer);
    if (!q || !a) continue;
    out.push(`<h3>${escapeHtml(q)}</h3>\n<p>${escapeHtml(a)}</p>`);
  }
  return out;
}

/** The Key facts table. Cell HTML is already escaped by the key facts builder. */
function tableLines(rows: KeyFactRow[]): string[] {
  return [
    "<table>",
    "<tbody>",
    ...rows.map((r) => `<tr><th scope="row">${escapeHtml(r.label)}</th><td>${r.html}</td></tr>`),
    "</tbody>",
    "</table>",
  ];
}

/**
 * A section: the H2, then the content. `spaced` puts a blank line after the
 * heading and between blocks (H3 items); otherwise the lines follow the
 * heading directly (a list, a table, plain paragraphs). Comments go last.
 */
function sectionHtml(heading: string, content: string[], comments: string[], spaced: boolean): string {
  const body = spaced
    ? [...content, ...(comments.length ? [comments.join("\n")] : [])].join("\n\n")
    : [...content, ...comments].join("\n");
  return `<section>\n<h2>${escapeHtml(heading)}</h2>\n${spaced ? "\n" : ""}${body}\n</section>`;
}

/** Text that cannot end or break an HTML comment. */
function commentText(s: string): string {
  return oneLine(s).replace(/<!--/g, "<!").replace(/-{2,}/g, "-");
}

/**
 * The "Still to fill" comments by placement. A field is commented when it is
 * in the draft's stillToFill or in the questions given, and a question is
 * known for it. Fields come out in template order.
 */
function stillToFillComments(input: RenderInput): Map<Placement, string[]> {
  const questions = input.questions ?? {};
  const order = new Map(ABOUT_V1.fields.map((f, i) => [f.id, i] as const));
  const sections = new Map(ABOUT_V1.fields.map((f) => [f.id, f.section] as const));
  const ids = [...new Set([...input.draft.stillToFill, ...Object.keys(questions)])]
    .filter((id) => oneLine(questions[id]).length > 0)
    .sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
  const out = new Map<Placement, string[]>();
  for (const id of ids) {
    const placement = PLACEMENTS[sections.get(id) ?? ""] ?? "end";
    const list = out.get(placement) ?? [];
    list.push(`<!-- Still to fill: ${commentText(questions[id])} -->`);
    out.set(placement, list);
  }
  return out;
}

/** The article's inner HTML as blocks; the caller joins them with blank lines. */
function articleBlocks(input: RenderInput): string[] {
  const { draft, companyName, keyFacts } = input;
  const comments = stillToFillComments(input);
  const take = (p: Placement): string[] => comments.get(p) ?? [];
  const end: string[] = [];
  const blocks: string[] = [];

  blocks.push(`<h1>${escapeHtml(oneLine(draft.title) || fillCompany("About [COMPANY]", companyName))}</h1>`);
  blocks.push(...paragraphLines(draft.intro));
  const intro = take("intro");
  if (intro.length) blocks.push(intro.join("\n"));

  const offerings = itemBlocks(draft.offerings);
  if (offerings.length) blocks.push(sectionHtml(sectionHeading("offerings", companyName), offerings, take("offerings"), true));
  else end.push(...take("offerings"));

  const differentiators = itemBlocks(draft.differentiators);
  if (differentiators.length) blocks.push(sectionHtml(sectionHeading("differentiators", companyName), differentiators, [], true));

  const customers = draft.customers.map(oneLine).filter(Boolean);
  if (customers.length) {
    const list = ["<ul>", ...customers.map((c) => `<li>${escapeHtml(c)}</li>`), "</ul>"];
    blocks.push(sectionHtml(sectionHeading("customers", companyName), list, [], false));
  }

  const team = [
    ...itemBlocks(draft.founders),
    ...titledBlock(fillCompany("How [COMPANY] started", companyName), draft.originStory),
    ...itemBlocks(draft.team),
    ...titledBlock("The team", draft.teamSummary),
  ];
  if (team.length) blocks.push(sectionHtml(sectionHeading("team", companyName), team, take("team"), true));
  else end.push(...take("team"));

  const process = paragraphLines(draft.process);
  if (process.length) blocks.push(sectionHtml(sectionHeading("process", companyName), process, take("process"), false));
  else end.push(...take("process"));

  if (keyFacts.length) blocks.push(sectionHtml(KEY_FACTS_HEADING, tableLines(keyFacts), [], false));

  const faq = faqBlocks(draft.faq);
  if (faq.length) blocks.push(sectionHtml(sectionHeading("faq", companyName), faq, [], true));

  blocks.push(...paragraphLines(draft.closing));

  end.push(...take("end"));
  if (end.length) blocks.push(end.join("\n"));
  return blocks;
}

// ---------------------------------------------------------------------------
// The two outputs
// ---------------------------------------------------------------------------

export function renderPageHtml(input: RenderInput): string {
  const { draft, companyName, pageUrl, jsonld } = input;
  const title = oneLine(draft.metaTitle) || oneLine(draft.title) || fillCompany("About [COMPANY]", companyName);
  const description = oneLine(draft.metaDescription);
  const canonical = safeHref(pageUrl);
  const lines = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    ...(description ? [`<meta name="description" content="${escapeHtml(description)}">`] : []),
    ...(canonical ? [`<link rel="canonical" href="${escapeHtml(canonical)}">`] : []),
    "",
    `<!-- ${JSONLD_COMMENT} -->`,
    jsonLdScript(jsonld),
    "",
    `<!-- ${STYLE_COMMENT} -->`,
    PREVIEW_STYLE,
    "</head>",
    "",
    "<body>",
    "<main>",
    "<article>",
    "",
    articleBlocks(input).join("\n\n"),
    "",
    "</article>",
    "</main>",
    "</body>",
    "</html>",
    "",
  ];
  return lines.join("\n");
}

export function renderWordpressHtml(input: RenderInput): string {
  return [`<!-- ${JSONLD_COMMENT} -->`, jsonLdScript(input.jsonld), "", articleBlocks(input).join("\n\n"), ""].join("\n");
}
