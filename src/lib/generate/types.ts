/*
  The page draft is the one source of truth the page, the WordPress HTML, and
  the schema are rendered from. The model writes it; the key facts table and
  the schema are built from the fact sheet by code. See docs/build-spec.md.
*/
import type { Json, PlatformT } from "@/lib/db/types";
import type { TokenUsage } from "@/lib/llm/cost";
import type { ModelId } from "@/config";

/** One H3 with its paragraphs. A paragraph starting with "> " renders as a blockquote. */
export interface DraftItem {
  heading: string;
  paragraphs: string[];
  /** Profile links for a person, or the page for a service, rendered as a line of links. */
  links?: { label: string; url: string }[];
}

export interface DraftFaq {
  question: string;
  answer: string;
}

export interface PageDraft {
  /** The <title>. */
  metaTitle: string;
  metaDescription: string;
  /** The H1, "About Legiit". */
  title: string;
  intro: string[];
  offerings: DraftItem[];
  differentiators: DraftItem[];
  customers: string[];
  founders: DraftItem[];
  originStory: string[];
  team: DraftItem[];
  teamSummary: string[];
  process: string[];
  faq: DraftFaq[];
  closing: string[];
  /** Ids of required fields the page could not cover. */
  stillToFill: string[];
}

export type LintKind =
  | "banned_word"
  | "dash"
  | "invented_number"
  | "faq_count"
  | "faq_length"
  | "long_sentence"
  | "exclamation"
  | "first_person"
  | "placeholder"
  | "empty";

export interface LintIssue {
  /** Where in the draft: "intro[0]", "offerings[2].paragraphs[1]", "faq[3].answer". */
  where: string;
  kind: LintKind;
  /** The offending text, short. */
  text: string;
  /** What to do about it, for the rewrite prompt and the screen. */
  hint: string;
}

export interface LintReport {
  passed: boolean;
  issues: LintIssue[];
  /** How many rewrite passes were made before this report. */
  attempts: number;
}

export interface KeyFactRow {
  label: string;
  /** Escaped HTML for the cell. */
  html: string;
  /** Plain text of the cell. */
  text: string;
}

export interface WriterResult {
  draft: PageDraft;
  usage: TokenUsage;
  costUsd: number;
  model: ModelId;
}

export interface RenderInput {
  draft: PageDraft;
  keyFacts: KeyFactRow[];
  jsonld: Record<string, unknown>;
  companyName: string;
  pageUrl: string;
  siteUrl: string;
  /** The questions for the fields still to fill, by field id, for the comments in the page. */
  questions?: Record<string, string>;
}

export type GenerationPart = "main" | "faq" | "lint" | "finish";

export interface GenerationCursor {
  part?: GenerationPart;
  lintAttempts?: number;
  attempts?: number;
  errorCount?: number;
}

export interface InstructionsInput {
  platform: PlatformT;
  companyName: string;
  existingSchema: { data: Json | null; raw: string; types: string[]; error?: string; url?: string }[];
  data: import("@/lib/facts/types").FactSheetData;
  pageUrl: string;
}

export type Allowance =
  | { ok: true; used: number; limit: number }
  | { ok: false; used: number; limit: number; message: string };

export type AllowanceKind = "project" | "crawl" | "generation";
