/*
  The page writer's structured output and its conversion to PageDraft.

  Three shapes for the three calls: the main sections (everything but the FAQ
  and the closing), the FAQ and the closing, and the whole draft for a rewrite.
  Structured outputs need closed objects with every property required, so an
  empty string or an empty array stands in for "nothing here", and plain
  strings stand in for enums (the strict-schema transform moves enums into the
  description, so the API would not enforce them anyway). The conversions trim
  everything and drop what is empty. Follows src/lib/extract/schema.ts.
*/
import { z } from "zod";
import type { DraftFaq, DraftItem, PageDraft } from "./types";

export const DraftLinkSchema = z.object({
  label: z
    .string()
    .describe("The link text: a platform name such as LinkedIn or YouTube, a page name, or a site's domain."),
  url: z.string().describe("A URL from the fact sheet, exactly as written there."),
});

export const DraftItemSchema = z.object({
  heading: z.string().describe("The H3 for this item."),
  paragraphs: z
    .array(z.string())
    .describe(
      'Plain-text paragraphs under the heading, one per string. A paragraph that starts with "> " renders as a block quote.',
    ),
  links: z
    .array(DraftLinkSchema)
    .describe(
      "Links rendered as one line under the paragraphs: a person's profiles or a service's page. An empty array when there are none.",
    ),
});

export const DraftFaqItemSchema = z.object({
  question: z.string().describe("The question, worded as a customer would ask it."),
  answer: z.string().describe("The answer: two or three sentences, each a fact from the fact sheet."),
});

const mainShape = {
  metaTitle: z.string().describe('The <title>: "About [COMPANY] | " and the category, under 60 characters.'),
  metaDescription: z.string().describe("The meta description: the intro's first sentence, under 160 characters."),
  title: z.string().describe('The H1: "About [COMPANY]".'),
  intro: z
    .array(z.string())
    .describe("Two or three paragraphs. The first sentence says what the company is and for whom."),
  offerings: z.array(DraftItemSchema).describe("One item per service or product."),
  differentiators: z.array(DraftItemSchema).describe("About five items, each a specific claim."),
  customers: z.array(z.string()).describe("One customer segment per string, rendered as a bullet list."),
  founders: z.array(DraftItemSchema).describe('One item per founder, heading "Name, Title".'),
  originStory: z.array(z.string()).describe('Paragraphs rendered under the H3 "How [COMPANY] started".'),
  team: z.array(DraftItemSchema).describe('One item per team member, heading "Name, Role".'),
  teamSummary: z.array(z.string()).describe('Paragraphs rendered under the H3 "The team": size and composition.'),
  process: z.array(z.string()).describe("Paragraphs on how the company works with a customer."),
};

const faqShape = {
  faq: z.array(DraftFaqItemSchema).describe("The FAQ, in order."),
  closing: z.array(z.string()).describe("One or two short closing lines."),
};

const stillToFillShape = {
  stillToFill: z
    .array(z.string())
    .describe(
      "The ids of the required fields the request lists as missing or unresolved, copied exactly. An empty array when there are none.",
    ),
};

/** Everything but the FAQ and the closing. */
export const DraftMainSchema = z.object({ ...mainShape, ...stillToFillShape });

/** The FAQ and the closing, written onto a draft that has the rest. */
export const DraftFaqSchema = z.object(faqShape);

/** The whole draft, for the rewrite. */
export const DraftFullSchema = z.object({ ...mainShape, ...faqShape, ...stillToFillShape });

export type DraftLinkOutput = z.infer<typeof DraftLinkSchema>;
export type DraftItemOutput = z.infer<typeof DraftItemSchema>;
export type DraftMainOutput = z.infer<typeof DraftMainSchema>;
export type DraftFaqOutput = z.infer<typeof DraftFaqSchema>;
export type DraftFullOutput = z.infer<typeof DraftFullSchema>;

/** One line of text: runs of whitespace collapsed, ends trimmed. Anything that is not a string is "". */
function text(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

function texts(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map(text).filter((s) => s.length > 0);
}

/** Ids, trimmed, without blanks or repeats. */
function ids(list: unknown): string[] {
  const out: string[] = [];
  for (const id of texts(list)) if (!out.includes(id)) out.push(id);
  return out;
}

/** A link as the page can use it: a scheme added where the model left it out ("chrismwalker.io"); nothing that is not a web address. */
export function webAddress(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(s) ? `https://${s}` : null;
  if (!withScheme) return null;
  try {
    // Kept as written once it parses, so "https://legiit.com" does not gain a slash.
    return new URL(withScheme).hostname.includes(".") ? withScheme : null;
  } catch {
    return null;
  }
}

function links(list: unknown): { label: string; url: string }[] {
  if (!Array.isArray(list)) return [];
  const out: { label: string; url: string }[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const link = raw as Partial<DraftLinkOutput>;
    const url = webAddress(text(link.url));
    if (!url) continue;
    out.push({ label: text(link.label) || url, url });
  }
  return out;
}

/** Items with their heading, paragraphs, and links cleaned; an item with no heading is dropped. */
function items(list: unknown): DraftItem[] {
  if (!Array.isArray(list)) return [];
  const out: DraftItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<DraftItemOutput>;
    const heading = text(item.heading);
    if (!heading) continue;
    const cleaned: DraftItem = { heading, paragraphs: texts(item.paragraphs) };
    const itemLinks = links(item.links);
    if (itemLinks.length) cleaned.links = itemLinks;
    out.push(cleaned);
  }
  return out;
}

function faqs(list: unknown): DraftFaq[] {
  if (!Array.isArray(list)) return [];
  const out: DraftFaq[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const pair = raw as Partial<DraftFaq>;
    const question = text(pair.question);
    const answer = text(pair.answer);
    if (!question || !answer) continue;
    out.push({ question, answer });
  }
  return out;
}

/** The main call's output as a draft with an empty FAQ and closing. */
export function draftFromMain(out: DraftMainOutput): PageDraft {
  return {
    metaTitle: text(out.metaTitle),
    metaDescription: text(out.metaDescription),
    title: text(out.title),
    intro: texts(out.intro),
    offerings: items(out.offerings),
    differentiators: items(out.differentiators),
    customers: texts(out.customers),
    founders: items(out.founders),
    originStory: texts(out.originStory),
    team: items(out.team),
    teamSummary: texts(out.teamSummary),
    process: texts(out.process),
    faq: [],
    closing: [],
    stillToFill: ids(out.stillToFill),
  };
}

/** The FAQ call's output written onto a draft that has the rest. */
export function draftWithFaq(draft: PageDraft, out: DraftFaqOutput): PageDraft {
  return { ...draft, faq: faqs(out.faq), closing: texts(out.closing) };
}

/** The rewrite call's output as a draft. */
export function draftFromFull(out: DraftFullOutput): PageDraft {
  return draftWithFaq(draftFromMain(out), out);
}

/**
 * A draft in the full output shape: what the rewrite prompt shows the model
 * so that "keep everything else word for word" is a plain echo. Items with no
 * links get an empty array, as the schema requires.
 */
export function draftToFullOutput(draft: PageDraft): DraftFullOutput {
  const item = (i: DraftItem): DraftItemOutput => ({
    heading: i.heading,
    paragraphs: [...i.paragraphs],
    links: (i.links ?? []).map((l) => ({ label: l.label, url: l.url })),
  });
  return {
    metaTitle: draft.metaTitle,
    metaDescription: draft.metaDescription,
    title: draft.title,
    intro: [...draft.intro],
    offerings: draft.offerings.map(item),
    differentiators: draft.differentiators.map(item),
    customers: [...draft.customers],
    founders: draft.founders.map(item),
    originStory: [...draft.originStory],
    team: draft.team.map(item),
    teamSummary: [...draft.teamSummary],
    process: [...draft.process],
    faq: draft.faq.map((f) => ({ question: f.question, answer: f.answer })),
    closing: [...draft.closing],
    stillToFill: [...draft.stillToFill],
  };
}

/** The main sections of a draft in the main output shape, for the FAQ prompt. */
export function draftToMainOutput(draft: PageDraft): DraftMainOutput {
  const full = draftToFullOutput(draft);
  return {
    metaTitle: full.metaTitle,
    metaDescription: full.metaDescription,
    title: full.title,
    intro: full.intro,
    offerings: full.offerings,
    differentiators: full.differentiators,
    customers: full.customers,
    founders: full.founders,
    originStory: full.originStory,
    team: full.team,
    teamSummary: full.teamSummary,
    process: full.process,
    stillToFill: full.stillToFill,
  };
}
