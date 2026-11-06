/*
  Pure helpers for the generation screens. The view is what the step route
  returns and the progress component renders (both go through
  generationViewFromRow). The narrowing helpers read the row's JSON columns
  (cursor, draft, lint report, still to fill) without trusting their shape,
  and the field helpers turn ids into the questions the screens show. Nothing
  here imports server-only code, next/headers, or Supabase, so vitest runs it
  in node.
*/
import type { GenerationRow, GenerationStatusT, Json, RunLogEntry } from "@/lib/db/types";
import type { FactSheetData } from "@/lib/facts/types";
import { fillCompany } from "@/lib/projects/view";
import type { TemplateSpec } from "@/templates/types";
import type {
  DraftFaq,
  DraftItem,
  GenerationCursor,
  GenerationPart,
  LintIssue,
  LintKind,
  LintReport,
  PageDraft,
} from "./types";

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** The status enum doubles as the phase: queued, writing, linting, done, failed. */
export type GenerationPhase = GenerationStatusT;

export interface GenerationView {
  id: string;
  projectId: string;
  version: number;
  status: GenerationStatusT;
  phase: GenerationPhase;
  /** The part the next step works on: main, faq, lint, finish. Null once failed with no cursor. */
  part: GenerationPart | null;
  /** 0..1 */
  progress: number;
  /** One line a person can read, such as "Writing the questions people ask". */
  message: string;
  costUsd: number;
  /** True once page_html is stored. */
  hasPage: boolean;
  /** The page's <title>, once written. */
  title: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  /** Issues left in the stored lint report. */
  lintIssues: number;
  /** Null until a lint report is stored. */
  lintPassed: boolean | null;
  /** Ids of required fields the page could not cover. */
  stillToFill: string[];
  log: RunLogEntry[];
}

/** The columns the progress and message need; tests build these without a full row. */
export type GenerationRowLike = Pick<GenerationRow, "status" | "error"> & { cursor?: Json | null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const PARTS: readonly GenerationPart[] = ["main", "faq", "lint", "finish"];

function isPart(v: unknown): v is GenerationPart {
  return typeof v === "string" && (PARTS as readonly string[]).includes(v);
}

/** The step state stored in generations.cursor, read without trusting its shape. */
export function generationCursorOf(cursor: Json | null | undefined): GenerationCursor {
  if (!isRecord(cursor)) return {};
  const out: GenerationCursor = {};
  if (isPart(cursor.part)) out.part = cursor.part;
  if (typeof cursor.lintAttempts === "number") out.lintAttempts = cursor.lintAttempts;
  if (typeof cursor.attempts === "number") out.attempts = cursor.attempts;
  if (typeof cursor.errorCount === "number") out.errorCount = cursor.errorCount;
  return out;
}

/**
 * The part the next step works on, from the status and the cursor. A status
 * decides which parts are possible, so a cursor that disagrees with it (a
 * half-written row) cannot send a step backwards or past the end.
 */
export function generationPart(row: GenerationRowLike): GenerationPart | null {
  const part = generationCursorOf(row.cursor).part;
  switch (row.status) {
    case "queued":
      return "main";
    case "writing":
      return part === "faq" ? "faq" : "main";
    case "linting":
      return part === "finish" ? "finish" : "lint";
    case "done":
      return "finish";
    case "failed":
      return part ?? null;
  }
}

/**
 * queued 0.05, writing the main sections 0.1, the main sections done 0.35,
 * the FAQ done 0.65, the lint passed 0.85, done 1. A failed generation keeps
 * nothing.
 */
export function generationProgress(row: GenerationRowLike): number {
  if (row.status === "done") return 1;
  if (row.status === "failed") return 0;
  if (row.status === "queued") return 0.05;
  switch (generationPart(row)) {
    case "main":
      return 0.1;
    case "faq":
      return 0.35;
    case "lint":
      return 0.65;
    case "finish":
      return 0.85;
    default:
      return 0;
  }
}

export function generationMessage(row: GenerationRowLike): string {
  if (row.status === "failed") return row.error?.trim() || "The page could not be written";
  if (row.status === "done") return "Your page is ready";
  if (row.status === "queued") return "Waiting to start";
  switch (generationPart(row)) {
    case "main":
      return "Writing the page";
    case "faq":
      return "Writing the questions people ask";
    case "lint":
      return "Checking the copy";
    case "finish":
      return "Building the schema and the files";
    default:
      return "Working";
  }
}

/** The one implementation both the step route and the progress screen use. */
export function generationViewFromRow(row: GenerationRow): GenerationView {
  const report = lintReportOf(row.lint_report);
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version ?? 0,
    status: row.status,
    phase: row.status,
    part: generationPart(row),
    progress: generationProgress(row),
    message: generationMessage(row),
    costUsd: Number(row.cost_usd ?? 0),
    hasPage: typeof row.page_html === "string" && row.page_html.length > 0,
    title: row.title?.trim() || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error ?? null,
    lintIssues: report?.issues.length ?? 0,
    lintPassed: report?.passed ?? null,
    stillToFill: stillToFillOf(row.still_to_fill),
    log: Array.isArray(row.log) ? row.log : [],
  };
}

/** Done or failed: nothing left to step. */
export function isGenerationFinished(view: Pick<GenerationView, "status">): boolean {
  return view.status === "done" || view.status === "failed";
}

export const GENERATION_STEPS = [
  { id: "main", label: "Write" },
  { id: "faq", label: "Questions" },
  { id: "lint", label: "Check" },
  { id: "finish", label: "Build" },
] as const;

/** 0..3 for the four parts, 4 for done, -1 for failed. */
export function generationStepIndex(view: Pick<GenerationView, "status" | "part">): number {
  if (view.status === "done") return 4;
  if (view.status === "failed") return -1;
  switch (view.part) {
    case "faq":
      return 1;
    case "lint":
      return 2;
    case "finish":
      return 3;
    default:
      return 0;
  }
}

const PART_WORDS: Record<GenerationPart, string> = {
  main: "writing the page",
  faq: "writing the questions people ask",
  lint: "checking the copy",
  finish: "building the files",
};

/** Why a generation failed when its steps kept being cut off before they finished. */
export function stalledGenerationMessage(part: GenerationPart | null): string {
  return `The page writer kept running out of time while ${PART_WORDS[part ?? "main"]}. Try it again later.`;
}

// ---------------------------------------------------------------------------
// The row's JSON columns
// ---------------------------------------------------------------------------

const LINT_KINDS: readonly LintKind[] = [
  "banned_word",
  "dash",
  "invented_number",
  "faq_count",
  "faq_length",
  "long_sentence",
  "exclamation",
  "first_person",
  "placeholder",
  "empty",
];

function lintIssueOf(raw: unknown): LintIssue | null {
  if (!isRecord(raw)) return null;
  const kind = typeof raw.kind === "string" && (LINT_KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as LintKind) : null;
  if (!kind) return null;
  return {
    where: typeof raw.where === "string" ? raw.where : "",
    kind,
    text: typeof raw.text === "string" ? raw.text : "",
    hint: typeof raw.hint === "string" ? raw.hint : "",
  };
}

/** The stored lint report, or null when none is stored yet. Issues of an unknown kind are left out. */
export function lintReportOf(raw: Json | null | undefined): LintReport | null {
  if (!isRecord(raw) || typeof raw.passed !== "boolean") return null;
  const issues = Array.isArray(raw.issues) ? raw.issues.map(lintIssueOf).filter((i): i is LintIssue => i !== null) : [];
  return { passed: raw.passed, issues, attempts: typeof raw.attempts === "number" ? raw.attempts : 0 };
}

/** The stored field ids; anything that is not a string is dropped. */
export function stillToFillOf(raw: Json | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : null;
}

function draftItemOf(raw: unknown): DraftItem | null {
  if (!isRecord(raw) || typeof raw.heading !== "string") return null;
  const paragraphs = stringList(raw.paragraphs);
  if (!paragraphs) return null;
  const item: DraftItem = { heading: raw.heading, paragraphs };
  if (Array.isArray(raw.links)) {
    const links: { label: string; url: string }[] = [];
    for (const l of raw.links) {
      if (isRecord(l) && typeof l.label === "string" && typeof l.url === "string") links.push({ label: l.label, url: l.url });
    }
    item.links = links;
  }
  return item;
}

function draftItems(v: unknown): DraftItem[] | null {
  if (!Array.isArray(v)) return null;
  const out: DraftItem[] = [];
  for (const raw of v) {
    const item = draftItemOf(raw);
    if (!item) return null;
    out.push(item);
  }
  return out;
}

function draftFaqs(v: unknown): DraftFaq[] | null {
  if (!Array.isArray(v)) return null;
  const out: DraftFaq[] = [];
  for (const raw of v) {
    if (!isRecord(raw) || typeof raw.question !== "string" || typeof raw.answer !== "string") return null;
    out.push({ question: raw.question, answer: raw.answer });
  }
  return out;
}

/**
 * The stored draft, or null when the column is empty or not in the draft's
 * shape, in which case the step writes the page again rather than render
 * something broken.
 */
export function draftOf(raw: Json | null | undefined): PageDraft | null {
  if (!isRecord(raw)) return null;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : null);
  const metaTitle = text("metaTitle");
  const metaDescription = text("metaDescription");
  const title = text("title");
  const intro = stringList(raw.intro);
  const offerings = draftItems(raw.offerings);
  const differentiators = draftItems(raw.differentiators);
  const customers = stringList(raw.customers);
  const founders = draftItems(raw.founders);
  const originStory = stringList(raw.originStory);
  const team = draftItems(raw.team);
  const teamSummary = stringList(raw.teamSummary);
  const process = stringList(raw.process);
  const faq = draftFaqs(raw.faq);
  const closing = stringList(raw.closing);
  const stillToFill = stringList(raw.stillToFill);
  if (
    metaTitle === null ||
    metaDescription === null ||
    title === null ||
    !intro ||
    !offerings ||
    !differentiators ||
    !customers ||
    !founders ||
    !originStory ||
    !team ||
    !teamSummary ||
    !process ||
    !faq ||
    !closing ||
    !stillToFill
  ) {
    return null;
  }
  return {
    metaTitle,
    metaDescription,
    title,
    intro,
    offerings,
    differentiators,
    customers,
    founders,
    originStory,
    team,
    teamSummary,
    process,
    faq,
    closing,
    stillToFill,
  };
}

// ---------------------------------------------------------------------------
// Fields: what is missing, what is still to fill
// ---------------------------------------------------------------------------

export interface FieldQuestion {
  id: string;
  label: string;
  section: string;
  /** The field's question with [COMPANY] filled in. */
  question: string;
}

function fieldQuestion(spec: TemplateSpec, id: string, companyName: string | null | undefined): FieldQuestion | null {
  const field = spec.fields.find((f) => f.id === id);
  if (!field) return null;
  return { id: field.id, label: field.label, section: field.section, question: fillCompany(field.question, companyName) };
}

/** Required fields with no value yet, in spec order, each with its question. */
export function missingRequiredFields(
  spec: TemplateSpec,
  data: FactSheetData | null | undefined,
  companyName: string | null | undefined,
): FieldQuestion[] {
  const fields = data?.fields ?? {};
  const out: FieldQuestion[] = [];
  for (const field of spec.fields) {
    if (!field.required) continue;
    const status = fields[field.id]?.status ?? "missing";
    if (status !== "missing") continue;
    const q = fieldQuestion(spec, field.id, companyName);
    if (q) out.push(q);
  }
  return out;
}

/**
 * The ids stored in still_to_fill: the required fields the fact sheet lacks,
 * plus any the writer named, in spec order. Ids the template does not know
 * are dropped.
 */
export function stillToFillIds(spec: TemplateSpec, data: FactSheetData | null | undefined, draft: Pick<PageDraft, "stillToFill">): string[] {
  const wanted = new Set<string>(draft.stillToFill);
  for (const f of missingRequiredFields(spec, data, null)) wanted.add(f.id);
  return spec.fields.filter((f) => wanted.has(f.id)).map((f) => f.id);
}

/** The questions for a list of field ids, in the order given; unknown ids are left out. */
export function fieldQuestions(spec: TemplateSpec, ids: readonly string[], companyName: string | null | undefined): FieldQuestion[] {
  const out: FieldQuestion[] = [];
  for (const id of ids) {
    const q = fieldQuestion(spec, id, companyName);
    if (q) out.push(q);
  }
  return out;
}

/** The questions keyed by field id, for the comments the renderer leaves in the page. */
export function questionsById(spec: TemplateSpec, ids: readonly string[], companyName: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of fieldQuestions(spec, ids, companyName)) out[q.id] = q.question;
  return out;
}

/** The review screen, scrolled to a field's card or a section. */
export function reviewHref(projectId: string, target?: { fieldId?: string; section?: string }): string {
  const base = `/app/projects/${projectId}`;
  if (target?.fieldId) return `${base}#field-${target.fieldId}`;
  if (target?.section) return `${base}#section-${target.section}`;
  return base;
}

// ---------------------------------------------------------------------------
// Lint issues in plain words
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<LintKind, string> = {
  banned_word: "A word the page does not use",
  dash: "A dash used as punctuation",
  invented_number: "A number that is not in the fact sheet",
  faq_count: "The number of questions",
  faq_length: "An answer that is too short or too long",
  long_sentence: "A sentence over 40 words",
  exclamation: "An exclamation mark",
  first_person: "First person outside a quote",
  placeholder: "A placeholder left in the text",
  empty: "An empty section",
};

export function lintKindLabel(kind: LintKind): string {
  return KIND_LABELS[kind] ?? kind;
}

/** Draft keys that hold a list of items with headings: "What it does, item 3". */
const ITEM_LISTS: Record<string, string> = {
  offerings: "What it does",
  differentiators: "What makes it different",
  founders: "Founders",
  team: "Team",
  faq: "Question",
};

/** Draft keys that hold a list of paragraphs or lines: "Intro, paragraph 2". */
const TEXT_LISTS: Record<string, [string, string]> = {
  intro: ["Intro", "paragraph"],
  customers: ["Who uses it", "item"],
  originStory: ["How it started", "paragraph"],
  teamSummary: ["The team", "paragraph"],
  process: ["How it works", "paragraph"],
  closing: ["Closing", "line"],
};

const PLAIN_KEYS: Record<string, string> = {
  metaTitle: "Title tag",
  metaDescription: "Meta description",
  title: "Heading",
  heading: "heading",
  paragraphs: "paragraph",
  links: "link",
  question: "question",
  answer: "answer",
  label: "label",
  url: "link",
};

/** "offerings[2].paragraphs[1]" as "What it does, item 3, paragraph 2". */
export function describeLintWhere(where: string): string {
  const parts: string[] = [];
  const segments = where.split(".").filter(Boolean);
  segments.forEach((segment, i) => {
    const m = /^([A-Za-z_]+)(?:\[(\d+)\])?$/.exec(segment);
    if (!m) {
      parts.push(segment);
      return;
    }
    const [, key, index] = m;
    const n = index === undefined ? null : Number(index) + 1;
    if (i === 0 && key in ITEM_LISTS) {
      const label = ITEM_LISTS[key];
      parts.push(n === null ? label : key === "faq" ? `${label} ${n}` : `${label}, item ${n}`);
      return;
    }
    if (i === 0 && key in TEXT_LISTS) {
      const [label, unit] = TEXT_LISTS[key];
      parts.push(n === null ? label : `${label}, ${unit} ${n}`);
      return;
    }
    const label = PLAIN_KEYS[key] ?? key;
    parts.push(n === null ? label : `${label} ${n}`);
  });
  return parts.join(", ") || "the page";
}

export interface LintIssueView {
  where: string;
  kind: string;
  text: string;
  hint: string;
}

/** The issues of a report as the Lint tab shows them. */
export function lintIssueViews(report: LintReport | null): LintIssueView[] {
  if (!report) return [];
  return report.issues.map((issue) => ({
    where: describeLintWhere(issue.where),
    kind: lintKindLabel(issue.kind),
    text: issue.text,
    hint: issue.hint,
  }));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "$0.08"; a cost under a cent reads "under $0.01"; nothing spent reads "$0.00". */
export function formatCost(usd: number): string {
  if (!(usd > 0)) return "$0.00";
  if (usd < 0.01) return "under $0.01";
  return `$${usd.toFixed(2)}`;
}
