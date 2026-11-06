/*
  The Sonnet prompts for the page writer. The system prompt is a pure function
  of the template spec: the same bytes for the main, FAQ, and rewrite calls of
  a generation, so the prompt cache applies to it. Everything about one company
  goes in the user prompt, which carries the fact sheet as compact JSON of the
  found and owner-provided fields only, and names the missing and conflicting
  fields so the writer knows what not to invent. Follows src/lib/extract/prompt.ts.
*/
import type { AddressValue, Evidence, FactField, FactSheetData, FactValue, ListItem } from "@/lib/facts/types";
import type { TemplateField, TemplateSection, TemplateSpec } from "@/templates/types";
import { BANNED } from "./lint";
import { draftToFullOutput, draftToMainOutput } from "./schema";
import type { LintReport, PageDraft } from "./types";

/** Evidence quotes are cut to this many characters in the prompt. */
export const QUOTE_CHARS = 300;

/** Evidence quotes per field in the prompt. */
export const QUOTES_PER_FIELD = 2;

/** The writing rules from docs/build-spec.md, every one, with the banned list from lint.ts. */
export const WRITING_RULES = [
  "- Plain words. Say what the business does and for whom. No marketing voice.",
  "- Open on the point: the first sentence of every paragraph states the fact.",
  '- Third person, by name ("Legiit vets freelancers"). No "we" outside a quote.',
  "- No em dashes or en dashes used as dashes. Commas, colons, or full stops.",
  `- No buzzwords. Never use these words or phrases: ${BANNED.join(", ")}. A banned word may stay only inside a quotation or a name the fact sheet carries (a service name, a credential), never in your own words.`,
  "- No exclamation marks. No rhetorical questions in body text.",
  "- Sentences under about 30 words.",
  "- Every number in the page (digits) must appear in the fact sheet's values or quotes, except years inside dates already there. Never invent a number, a name, a date, a price, or a place; never fill in from general knowledge.",
  '- No placeholders: "[insert", "TBD", "lorem", "XXX".',
  "- FAQ: 10 to 12 questions; answers of 2 to 3 sentences.",
  "- No empty section when the facts exist; a section with no facts is left out of the page (not written around).",
].join("\n");

// ---------------------------------------------------------------------------
// The system prompt
// ---------------------------------------------------------------------------

/** What to write for each section of the spec, by section id. Headings use [COMPANY] like the spec. */
const SECTION_RULES: Record<string, (spec: TemplateSpec) => string[]> = {
  basics: () => [
    'title: the H1, "About [COMPANY]".',
    'metaTitle: "About [COMPANY] | " and the category, under 60 characters. metaDescription: the intro\'s first sentence, under 160 characters.',
    "intro: two or three paragraphs. The first sentence says what the company is and for whom, from category, core_offering, and ideal_customer. Then founded_date, team_size, and mission where known, each as the fact sheet states it.",
  ],
  offerings: () => [
    "offerings: one item per services entry. heading: the service's name. paragraphs: two or three sentences from its description, with the price where the fact sheet gives one. links: the service's url when it has one, labelled with the service's name.",
    "pricing, price_range, contract_terms, and free_offer feed the sentences on cost. The Key facts table repeats them, so state them once.",
  ],
  differentiators: () => [
    "differentiators: about five items from differentiators. heading: the claim. paragraphs: the detail, quantified where the facts allow. Name the competitors the fact sheet names. awards, memberships, notable_clients, customers_served, projects_delivered, and track_record belong here, in the item they support or as an item of their own.",
    'founder_quote, when it has a value: in the item it fits best, a short paragraph that names the person ("Chris M. Walker, the founder, puts it this way:"), then one paragraph that is "> " followed by the quote word for word, in quotation marks.',
  ],
  customers: () => ["customers: one string per customer_segments item, as the fact sheet states it. The page renders them as a bullet list."],
  team: () => [
    'founders: one item per founders entry. heading: "Name, Title". paragraphs: two sentences of backstory from bio and credentials. links: the person\'s url, linkedin, youtube, x, facebook, instagram, and website, labelled LinkedIn, YouTube, X, Facebook, Instagram, and a site by its domain.',
    'originStory: paragraphs from origin_story. The page renders them under the H3 "How [COMPANY] started".',
    'team: one item per team_members entry. heading: "Name, Role". paragraphs: one or two sentences from credentials and specialties. links: the profile url when there is one.',
    'teamSummary: paragraphs from team_size and team_composition. The page renders them under the H3 "The team".',
  ],
  process: () => [
    "process: paragraphs, in this order where the facts exist: communication_channels with response_time, who_you_work_with, turnaround, onboarding, policies.",
  ],
  faq: (spec) => [
    `faq: ${spec.faq.min} to ${spec.faq.max} questions, each answered in ${spec.faq.answerSentencesMin} to ${spec.faq.answerSentencesMax} sentences. Take existing_faqs first, question and answer as the site states them, then add the questions a customer would ask that the page's facts answer. Questions in the customer's words. The FAQ schema repeats every pair word for word, so each answer stands on its own and names [COMPANY] rather than "we".`,
  ],
  social: () => [
    "Profile links for people go in their founders and team items. The business's own profiles go in the Key facts table, which a program builds; do not write them.",
  ],
};

function sectionLine(section: TemplateSection): string {
  if (section.heading) return `"${section.heading}" (${section.id}): ${section.description}`;
  return `${section.title} (${section.id}, feeds other sections): ${section.description}`;
}

/** The sections in order, each with its fields (id and label) and the rules for what to write. */
function sectionPlan(spec: TemplateSpec): string[] {
  const sections = [...spec.sections].sort((a, b) => a.order - b.order);
  const lines: string[] = [];
  for (const section of sections) {
    const fields = spec.fields.filter((f) => f.section === section.id && f.rendersIn.includes("page"));
    lines.push(sectionLine(section));
    if (fields.length) lines.push(`  Fields: ${fields.map((f) => `${f.id} (${f.label})`).join("; ")}`);
    for (const rule of SECTION_RULES[section.id]?.(spec) ?? []) lines.push(`  - ${rule}`);
    lines.push("");
  }
  lines.push(
    'Key facts: a table between "How [COMPANY] works" and the FAQ that a program builds from the fact sheet. Do not write it.',
    "closing: one or two short lines after the FAQ.",
  );
  return lines;
}

export function buildWriterSystemPrompt(spec: TemplateSpec): string {
  return [
    `You write the "${spec.name}" for a business website from its fact sheet, as JSON for a program that renders the page and its schema.`,
    "",
    "The fact sheet was built from the site's own pages with a quote behind every value, and the owner has checked it. The page is for people and for the AI systems that answer questions about the business, so every sentence is a checkable fact from the fact sheet, in plain words. A program lints the draft against the fact sheet and the rules below and sends back anything to rewrite.",
    "",
    "Writing rules",
    WRITING_RULES,
    "",
    "The page, section by section. [COMPANY] stands for the company name given in the request. Field ids refer to the fact sheet in the request.",
    "",
    ...sectionPlan(spec),
    "",
    "Output",
    "- Every property is required. Use an empty string or an empty array where there is nothing; never a placeholder or a note to the owner.",
    '- A section whose facts are missing stays an empty array. Nothing is written around a gap: no "contact [COMPANY] for details", no general statement in place of a fact.',
    '- Paragraphs are plain text, one per string, with no HTML and no markup. The one exception is the "> " that opens a quoted paragraph.',
    "- Links carry a label and a URL the fact sheet gives; never a URL from memory.",
    "- Every number must be in the fact sheet, in a value or a quote. Never invent. A required field with no value goes in stillToFill, and nothing is written around it.",
    "- stillToFill: the ids of the required fields the request lists as missing or unresolved, copied exactly.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The fact sheet block
// ---------------------------------------------------------------------------

function text(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

function isListItems(v: FactValue): v is ListItem[] {
  return Array.isArray(v);
}

function isAddress(v: FactValue): v is AddressValue {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The non-empty string keys of an item or an address, cleaned. */
function compactRecord(rec: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rec)) {
    const v = text(value);
    if (v) out[key] = v;
  }
  return out;
}

/** The value as compact JSON: a string, list items with every key that has a value, or the address parts. */
function compactValue(value: FactValue): string | Record<string, string>[] | Record<string, string> | null {
  if (typeof value === "string") return text(value) || null;
  if (isListItems(value)) {
    const items = value.map(compactRecord).filter((item) => Object.keys(item).length > 0);
    return items.length ? items : null;
  }
  if (isAddress(value)) {
    const addr = compactRecord({ ...value });
    return Object.keys(addr).length ? addr : null;
  }
  return null;
}

function hasValue(field: FactField | undefined): boolean {
  return field !== undefined && compactValue(field.value) !== null;
}

/** Evidence from the page and the owner before evidence read out of markup. */
const SOURCE_RANK: Record<Evidence["source"], number> = { page: 0, user: 1, jsonld: 2, meta: 3, link: 4, image: 5 };

/** Up to QUOTES_PER_FIELD distinct quotes, each cut to QUOTE_CHARS, page and owner quotes first. */
export function promptQuotes(evidence: Evidence[]): string[] {
  const ranked = evidence
    .map((e, i) => ({ quote: text(e.quote), rank: SOURCE_RANK[e.source] ?? 9, i }))
    .filter((e) => e.quote.length > 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i);
  const out: string[] = [];
  for (const e of ranked) {
    const quote = e.quote.length > QUOTE_CHARS ? e.quote.slice(0, QUOTE_CHARS).trimEnd() : e.quote;
    if (out.includes(quote)) continue;
    out.push(quote);
    if (out.length >= QUOTES_PER_FIELD) break;
  }
  return out;
}

function fieldJson(field: FactField): string {
  const out: { value: ReturnType<typeof compactValue>; quotes?: string[] } = { value: compactValue(field.value) };
  const quotes = promptQuotes(field.evidence ?? []);
  if (quotes.length) out.quotes = quotes;
  return JSON.stringify(out);
}

function labelWithId(field: TemplateField): string {
  return field.required ? `${field.label} (required; id ${field.id})` : field.label;
}

/**
 * The fact sheet for the prompt: the found and owner-provided page fields as
 * compact JSON by field id, one field per line, then the fields in conflict
 * and the fields with no value by label, and the ids that go in stillToFill.
 * Fields that render only in the schema are left out; the writer never sees
 * them. `skip` names fields to leave out of the JSON (the FAQ prompt shows
 * existing_faqs as a list instead).
 */
export function buildFactSheetBlock(
  spec: TemplateSpec,
  data: FactSheetData,
  opts: { skip?: string[]; stillToFill?: boolean } = {},
): string[] {
  const skip = new Set(opts.skip ?? []);
  const found: string[] = [];
  const conflict: string[] = [];
  const missing: string[] = [];
  const still: string[] = [];
  for (const f of spec.fields) {
    if (!f.rendersIn.includes("page")) continue;
    const field = data.fields[f.id];
    const status = field?.status;
    if ((status === "found" || status === "user_provided") && hasValue(field)) {
      if (!skip.has(f.id)) found.push(`"${f.id}": ${fieldJson(field)}`);
    } else if (status === "conflict") {
      conflict.push(labelWithId(f));
      if (f.required) still.push(f.id);
    } else {
      missing.push(labelWithId(f));
      if (f.required) still.push(f.id);
    }
  }
  const lines = [
    'Fact sheet: the found and owner-provided fields, by field id. "value" is the fact; "quotes" are the site\'s own words behind it. Use nothing that is not here.',
    "{",
    found.join(",\n"),
    "}",
    "",
    `Fields in conflict (the owner has not resolved this; do not use it): ${conflict.length ? conflict.join("; ") : "none"}`,
    `Fields with no value (unknown; do not invent): ${missing.length ? missing.join("; ") : "none"}`,
  ];
  if (opts.stillToFill !== false) {
    lines.push(`stillToFill: ${still.length ? still.join(", ") : "none (an empty array)"}`);
  }
  return lines;
}

/** The existing_faqs list as numbered question and answer pairs. */
function existingFaqLines(data: FactSheetData): string[] {
  const field = data.fields.existing_faqs;
  const value = field?.value;
  const usable = field !== undefined && (field.status === "found" || field.status === "user_provided");
  const pairs = usable && isListItems(value) ? value : [];
  const lines: string[] = [];
  let n = 0;
  for (const item of pairs) {
    const question = text(item.question);
    const answer = text(item.answer);
    if (!question || !answer) continue;
    n += 1;
    lines.push(`${n}. Q: ${question}`, `   A: ${answer}`);
  }
  return lines.length ? lines : ["(none on the site: write every question from the page's facts)"];
}

// ---------------------------------------------------------------------------
// The user prompts
// ---------------------------------------------------------------------------

export interface WriterPromptInput {
  spec: TemplateSpec;
  data: FactSheetData;
  siteUrl: string;
  companyName: string;
  part: "main" | "faq";
  /** The draft so far, for the faq part. */
  draft?: PageDraft;
}

export function buildWriterUserPrompt(input: WriterPromptInput): string {
  const { spec, data, siteUrl, companyName, part } = input;
  const lines: string[] = [];
  if (part === "main") {
    lines.push(`Write the main sections of the About page for ${companyName}: everything except the FAQ and the closing.`);
  } else {
    if (!input.draft) throw new Error("The faq part needs the draft so far.");
    lines.push(`Write the FAQ and the closing lines of the About page for ${companyName}.`);
  }
  lines.push("", `Company name ([COMPANY] in the rules): ${companyName}`, `Site: ${siteUrl}`, "");
  lines.push(...buildFactSheetBlock(spec, data, { skip: part === "faq" ? ["existing_faqs"] : [] }));
  if (part === "faq" && input.draft) {
    lines.push(
      "",
      "The draft so far, the main sections as JSON. The FAQ may repeat its facts; keep stillToFill as it is.",
      JSON.stringify(draftToMainOutput(input.draft), null, 1),
      "",
      "Questions already answered on the site (existing_faqs), to use first:",
      ...existingFaqLines(data),
    );
  }
  return lines.join("\n");
}

function companyNameOf(data: FactSheetData, draft: PageDraft): string {
  const field = data.fields.company_name;
  const name = typeof field?.value === "string" ? text(field.value) : "";
  if (name) return name;
  const fromTitle = draft.title.replace(/^about\s+/i, "").trim();
  return fromTitle || "the company";
}

export function buildRewritePrompt(input: {
  spec: TemplateSpec;
  data: FactSheetData;
  draft: PageDraft;
  report: LintReport;
}): string {
  const { spec, data, draft, report } = input;
  const issues = report.issues.map((i) => `- ${i.where} (${i.kind}): ${JSON.stringify(i.text)}. ${i.hint}`);
  return [
    `Rewrite the flagged text in this About page draft for ${companyNameOf(data, draft)} and return the whole draft.`,
    "",
    "Change only the text the issues name, in the smallest way that fixes each issue, and keep everything else word for word: every other heading, paragraph, bullet, question, answer, link, and stillToFill entry stays exactly as it is. Do not add sections. A fix may cut a word, a sentence, or a number, and may add only a fact that is in the fact sheet below.",
    "",
    `Issues (${issues.length}), as where (kind): text, then what to do:`,
    ...(issues.length ? issues : ["- none"]),
    "",
    "The draft, as JSON in the shape to return:",
    JSON.stringify(draftToFullOutput(draft), null, 1),
    "",
    ...buildFactSheetBlock(spec, data, { stillToFill: false }),
  ].join("\n");
}
