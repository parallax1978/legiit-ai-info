/*
  Pure helpers for the project screens. The run view is shared with
  POST /api/runs/[id]/step (it imports runViewFromRow from here), the counts
  feed the review screen, and the formatters render values by field type.
  Nothing here imports server-only code, next/headers, or Supabase, so vitest
  runs it in node.
*/
import type {
  CrawlRunRow,
  JsonLdBlock,
  PageStatusT,
  PlatformT,
  RunCursor,
  RunLogEntry,
  RunPhaseT,
  RunStatusT,
} from "@/lib/db/types";
import {
  emptyField,
  type AddressValue,
  type EvidenceSource,
  type FactField,
  type FactSheetData,
  type FactStatus,
  type FactValue,
  type ListItem,
  type ListItemConflict,
} from "@/lib/facts/types";
import type { TemplateField, TemplateSpec } from "@/templates/types";

// ---------------------------------------------------------------------------
// The run view: what the progress screen renders and the step route returns
// ---------------------------------------------------------------------------

export interface RunView {
  id: string;
  projectId: string;
  status: RunStatusT;
  phase: RunPhaseT;
  pagesPlanned: number;
  pagesFetched: number;
  pagesFailed: number;
  pagesExtracted: number;
  textBytes: number;
  platform: PlatformT;
  log: RunLogEntry[];
  error: string | null;
  factSheetId: string | null;
  /** True once the run reached the done phase. Failed and cancelled runs are not done. */
  done: boolean;
  /** 0..1 */
  progress: number;
  /** One line a person can read, such as "Reading the pricing page (12 of 31)". */
  message: string;
}

/** The columns the progress and message need; tests build these without a full row. */
export type RunRowLike = Pick<
  CrawlRunRow,
  "status" | "phase" | "pages_planned" | "pages_fetched" | "pages_failed" | "pages_extracted" | "error"
> & { cursor?: RunCursor | null };

export const PHASE_STEPS = [
  { id: "discover", label: "Discover" },
  { id: "fetch", label: "Read" },
  { id: "extract", label: "Extract" },
  { id: "merge", label: "Merge" },
] as const;

/** 0..3 for the four working phases, 4 for done, -1 for failed. */
export function phaseIndex(phase: RunPhaseT): number {
  switch (phase) {
    case "discover":
      return 0;
    case "fetch":
      return 1;
    case "extract":
      return 2;
    case "merge":
      return 3;
    case "done":
      return 4;
    default:
      return -1;
  }
}

function ratio(n: number, d: number): number {
  if (!(d > 0)) return 0;
  return Math.min(1, Math.max(0, n / d));
}

function isDone(row: Pick<RunRowLike, "status" | "phase">): boolean {
  return row.status === "done" || row.phase === "done";
}

function isFailed(row: Pick<RunRowLike, "status" | "phase">): boolean {
  return row.status === "failed" || row.phase === "failed";
}

/**
 * discover 0.05, fetch 0.05..0.6 by pagesFetched/pagesPlanned, extract
 * 0.6..0.95 by pagesExtracted/pagesPlanned, merge 0.97, done 1. A queued run
 * is at 0 and a failed one keeps nothing.
 */
export function runProgress(row: RunRowLike): number {
  if (isDone(row)) return 1;
  if (isFailed(row) || row.status === "cancelled") return 0;
  if (row.status === "queued") return 0;
  switch (row.phase) {
    case "discover":
      return 0.05;
    case "fetch":
      return round(0.05 + 0.55 * ratio(row.pages_fetched, row.pages_planned));
    case "extract":
      return round(0.6 + 0.35 * ratio(row.pages_extracted, row.pages_planned));
    case "merge":
      return 0.97;
    default:
      return 0;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "the pricing page", "the home page", "the about us page". */
export function pageLabelFromUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "a page";
  }
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return "the home page";
  let last = segments[segments.length - 1];
  try {
    last = decodeURIComponent(last);
  } catch {
    // keep the raw segment
  }
  const words = last
    .replace(/\.(?:html?|php|aspx?|jsp)$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "the home page";
  const short = words.length > 40 ? `${words.slice(0, 37).trimEnd()}...` : words;
  return `the ${short} page`;
}

export function runMessage(row: RunRowLike): string {
  if (row.status === "cancelled") return "Scan cancelled";
  if (isFailed(row)) return row.error?.trim() || "The scan failed";
  if (isDone(row)) {
    const n = row.pages_fetched;
    return `Scan complete: ${n} ${plural(n, "page", "pages")} read`;
  }
  if (row.status === "queued") return "Waiting to start";
  switch (row.phase) {
    case "discover":
      return "Finding pages on the site";
    case "fetch": {
      const planned = row.pages_planned;
      if (!(planned > 0)) return "Reading pages";
      const next = row.cursor?.queue?.[0]?.url;
      const current = Math.min(row.pages_fetched + row.pages_failed + (next ? 1 : 0), planned);
      return `Reading ${next ? pageLabelFromUrl(next) : "pages"} (${current} of ${planned})`;
    }
    case "extract": {
      const total = row.pages_fetched;
      if (!(total > 0)) return "Pulling facts from the pages";
      const current = Math.min(row.pages_extracted + 1, total);
      return `Pulling facts from page ${current} of ${total}`;
    }
    case "merge":
      return "Putting the fact sheet together";
    default:
      return "Working";
  }
}

/** The one implementation both the step route and the progress screen use. */
export function runViewFromRow(row: CrawlRunRow): RunView {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    phase: row.phase,
    pagesPlanned: row.pages_planned ?? 0,
    pagesFetched: row.pages_fetched ?? 0,
    pagesFailed: row.pages_failed ?? 0,
    pagesExtracted: row.pages_extracted ?? 0,
    textBytes: Number(row.text_bytes ?? 0),
    platform: row.platform,
    log: Array.isArray(row.log) ? row.log : [],
    error: row.error ?? null,
    factSheetId: row.fact_sheet_id ?? null,
    done: isDone(row),
    progress: runProgress(row),
    message: runMessage(row),
  };
}

/** Done, failed, or cancelled: nothing left to step. */
export function isRunFinished(view: Pick<RunView, "done" | "status">): boolean {
  return view.done || view.status === "failed" || view.status === "cancelled";
}

// ---------------------------------------------------------------------------
// Pages and schema shown on the project page
// ---------------------------------------------------------------------------

export interface PageSummary {
  id: string;
  url: string;
  title: string | null;
}

export interface PageDetail extends PageSummary {
  status: PageStatusT;
  rank: number;
  reason: string | null;
  httpStatus: number | null;
  textChars: number;
  error: string | null;
}

export interface SchemaGroup {
  url: string;
  title: string | null;
  blocks: JsonLdBlock[];
}

/** Every JSON-LD block found, grouped by the page it was on; pages with none are left out. */
export function schemaGroups(pages: (PageSummary & { jsonld: JsonLdBlock[] | null })[]): SchemaGroup[] {
  const out: SchemaGroup[] = [];
  for (const p of pages) {
    const blocks = Array.isArray(p.jsonld) ? p.jsonld : [];
    if (!blocks.length) continue;
    out.push({ url: p.url, title: p.title, blocks });
  }
  return out;
}

export function prettyJsonLd(block: JsonLdBlock): string {
  if (block.data !== null && block.data !== undefined) {
    try {
      return JSON.stringify(block.data, null, 2);
    } catch {
      // fall through to the raw text
    }
  }
  return block.raw ?? "";
}

// ---------------------------------------------------------------------------
// URLs and labels
// ---------------------------------------------------------------------------

function parseUrl(url: string): URL | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

/** Host without www. */
export function hostOf(url: string): string {
  const u = parseUrl(url);
  return u ? u.hostname.replace(/^www\./i, "") : url.trim();
}

/** "legiit.com/about" for https://www.legiit.com/about/; the bare host for the home page. */
export function hostPath(url: string): string {
  const u = parseUrl(url);
  if (!u) return url.trim();
  const host = u.hostname.replace(/^www\./i, "");
  const path = u.pathname.replace(/\/+$/, "");
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // keep the encoded path
  }
  return `${host}${decoded}`;
}

/** Lowercase host and path, no scheme, no www, no trailing slash, no hash or query. */
export function urlKey(url: string): string {
  const u = parseUrl(url);
  if (!u) return url.trim().toLowerCase().replace(/\/+$/, "");
  return `${u.hostname.replace(/^www\./i, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

/** The page title when the crawl has it, else host and path. An empty URL is the user. */
export function sourceLabel(url: string, pages: PageSummary[]): string {
  if (!url || !url.trim()) return "You";
  const key = urlKey(url);
  const page = pages.find((p) => urlKey(p.url) === key);
  const title = page?.title?.trim();
  if (title) return title;
  return hostPath(url);
}

const SOURCE_TAGS: Record<EvidenceSource, string> = {
  page: "page",
  jsonld: "schema",
  link: "link",
  meta: "meta",
  image: "image",
  user: "you",
};

export function sourceTag(source: EvidenceSource): string {
  return SOURCE_TAGS[source] ?? source;
}

const STATUS_LABELS: Record<FactStatus, string> = {
  found: "Found",
  conflict: "Conflict",
  missing: "Missing",
  user_provided: "You provided",
};

export function statusLabel(status: FactStatus): string {
  return STATUS_LABELS[status] ?? status;
}

const PAGE_STATUS_LABELS: Record<PageStatusT, string> = {
  queued: "Queued",
  fetched: "Read",
  extracted: "Extracted",
  skipped: "Skipped",
  failed: "Failed",
};

export function pageStatusLabel(status: PageStatusT): string {
  return PAGE_STATUS_LABELS[status] ?? status;
}

const PLATFORM_LABELS: Record<PlatformT, string | null> = {
  wordpress: "WordPress",
  shopify: "Shopify",
  wix: "Wix",
  squarespace: "Squarespace",
  webflow: "Webflow",
  other: "Custom site",
  unknown: null,
};

/** Null when the platform is unknown, so no pill is shown. */
export function platformLabel(platform: PlatformT): string | null {
  return PLATFORM_LABELS[platform] ?? null;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export const ADDRESS_KEYS = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"] as const;

export const ADDRESS_LABELS: Record<string, string> = {
  streetAddress: "Street",
  addressLocality: "City",
  addressRegion: "Region or state",
  postalCode: "Postal code",
  addressCountry: "Country",
};

export function isAddressValue(value: FactValue): value is AddressValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isListValue(value: FactValue): value is ListItem[] {
  return Array.isArray(value);
}

/** Street, then "City, Region Postal", then country. Falls back to the one-line text. */
export function addressLines(a: AddressValue): string[] {
  const street = a.streetAddress?.trim();
  const cityRegion = [a.addressLocality?.trim(), a.addressRegion?.trim()].filter(Boolean).join(", ");
  const line2 = [cityRegion, a.postalCode?.trim()].filter(Boolean).join(" ");
  const country = a.addressCountry?.trim();
  const lines = [street, line2, country].filter((l): l is string => Boolean(l));
  if (lines.length) return lines;
  const text = a.text?.trim();
  return text ? [text] : [];
}

export function formatAddress(a: AddressValue): string {
  return addressLines(a).join(", ");
}

/**
 * True for an address that exists only as one line of text, with none of the
 * given parts set. The merge stores an address that way when a page gives it
 * as a single string.
 */
export function isOneLineAddress(a: AddressValue, keys: readonly string[] = ADDRESS_KEYS): boolean {
  const parts = a as Record<string, string | undefined>;
  return Boolean(a.text?.trim()) && !keys.some((k) => parts[k]?.trim());
}

/** The address an editor saves from its part inputs: trimmed parts, and the one-line text built from them. */
export function addressFromParts(parts: Record<string, string | undefined>, keys: readonly string[] = ADDRESS_KEYS): AddressValue {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = parts[k]?.trim();
    if (v) out[k] = v;
  }
  const address = out as AddressValue;
  const text = formatAddress(address);
  if (text) address.text = text;
  return address;
}

/** The address an editor saves from a single line. */
export function addressFromLine(line: string): AddressValue {
  const text = line.trim();
  return text ? { text } : {};
}

/** The item's values in item-shape order, joined with " / ". */
export function formatListItem(field: Pick<TemplateField, "itemShape">, item: ListItem): string {
  const keys = field.itemShape?.length ? field.itemShape.map((s) => s.key) : Object.keys(item);
  return keys
    .map((k) => item[k]?.trim())
    .filter((v): v is string => Boolean(v))
    .join(" / ");
}

/** A one-line rendering of any value, by the field's type. Empty string for nothing. */
export function formatValue(field: Pick<TemplateField, "type" | "itemShape">, value: FactValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => formatListItem(field, item))
      .filter(Boolean)
      .join("; ");
  }
  return formatAddress(value);
}

export function isEmptyValue(value: FactValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return !value.some((item) => Object.values(item).some((v) => v && v.trim()));
  return addressLines(value).length === 0;
}

/** Short lists with short cells read as a table; anything with long text stacks. */
export function listLayout(field: Pick<TemplateField, "id" | "itemShape">): "table" | "stack" {
  if (field.id === "founders" || field.id === "team_members") return "stack";
  const shape = field.itemShape ?? [];
  if (shape.length > 3) return "stack";
  if (shape.some((s) => s.type === "long_text")) return "stack";
  return "table";
}

export function itemLabel(field: Pick<TemplateField, "itemShape">, key: string): string {
  return field.itemShape?.find((s) => s.key === key)?.label ?? key;
}

export function dedupeKeyOf(field: Pick<TemplateField, "dedupeKey" | "itemKind" | "itemShape">): string {
  if (field.dedupeKey) return field.dedupeKey;
  if (field.itemKind === "person") return "name";
  if (field.itemKind === "social") return "url";
  return field.itemShape?.[0]?.key ?? "";
}

function looseKey(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** The per-item conflict that belongs to this list item, matched on the dedupe key. */
export function conflictForItem(
  field: Pick<TemplateField, "dedupeKey" | "itemKind" | "itemShape">,
  item: ListItem,
  conflicts: ListItemConflict[] | undefined,
): ListItemConflict | undefined {
  if (!conflicts?.length) return undefined;
  const key = dedupeKeyOf(field);
  const own = looseKey(item[key]);
  if (!own) return undefined;
  return conflicts.find((c) => looseKey(c.key) === own);
}

/** The disagreeing keys of one candidate item as "Label: value" pairs. */
export function candidateItemSummary(
  field: Pick<TemplateField, "itemShape">,
  value: FactValue,
  on: string[],
): string {
  if (!Array.isArray(value) || !value.length) return formatValue({ type: "list", itemShape: field.itemShape }, value);
  const item = value[0];
  const pairs = on
    .map((k) => {
      const v = item[k]?.trim();
      return v ? `${itemLabel(field, k)}: ${v}` : "";
    })
    .filter(Boolean);
  return pairs.length ? pairs.join(", ") : formatListItem(field, item);
}

/**
 * How a person can undo their own value. "restore" puts back what the scan
 * found. "clear" deletes the answer and the field is missing again, which is
 * all a clear can do when the scan found nothing (the saved snapshot of a
 * missing field is itself missing). Null when the value is not theirs.
 */
export function undoForUserValue(field: Pick<FactField, "status" | "crawled">): "restore" | "clear" | null {
  if (field.status !== "user_provided") return null;
  return field.crawled && field.crawled.status !== "missing" ? "restore" : "clear";
}

/** "[COMPANY]" in a question becomes the company name, or "the business". */
export function fillCompany(text: string, companyName: string | null | undefined): string {
  const name = companyName?.trim() || "the business";
  return text.replace(/\[COMPANY\]/g, name);
}

export function companyNameOf(fields: Record<string, FactField | undefined>): string | null {
  const f = fields.company_name;
  if (!f || f.status === "missing" || typeof f.value !== "string") return null;
  const v = f.value.trim();
  return v || null;
}

/** Every spec field, with missing entries filled in as empty. */
export function normalizeFields(spec: TemplateSpec, data: FactSheetData | null | undefined): Record<string, FactField> {
  const out: Record<string, FactField> = {};
  const source = data?.fields ?? {};
  for (const field of spec.fields) {
    const f = source[field.id];
    out[field.id] = f && typeof f === "object" ? f : emptyField();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export interface StatusCounts {
  found: number;
  conflict: number;
  missing: number;
  userProvided: number;
  /** Required fields that are still missing or contradicted. */
  requiredMissing: number;
  total: number;
}

export interface SectionCounts {
  id: string;
  title: string;
  description: string;
  counts: StatusCounts;
}

function countFields(fields: TemplateField[], data: FactSheetData): StatusCounts {
  const counts: StatusCounts = { found: 0, conflict: 0, missing: 0, userProvided: 0, requiredMissing: 0, total: 0 };
  for (const field of fields) {
    const status = data.fields[field.id]?.status ?? "missing";
    counts.total++;
    if (status === "found") counts.found++;
    else if (status === "conflict") counts.conflict++;
    else if (status === "user_provided") counts.userProvided++;
    else counts.missing++;
    if (field.required && (status === "missing" || status === "conflict")) counts.requiredMissing++;
  }
  return counts;
}

export function statusCounts(spec: TemplateSpec, data: FactSheetData): StatusCounts {
  return countFields(spec.fields, data);
}

/** One entry per section in spec order, with the counts of its fields. */
export function sectionCounts(spec: TemplateSpec, data: FactSheetData): SectionCounts[] {
  const sections = [...spec.sections].sort((a, b) => a.order - b.order);
  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    counts: countFields(
      spec.fields.filter((f) => f.section === s.id),
      data,
    ),
  }));
}

/** found + user_provided over total, 0..1. */
export function completion(counts: StatusCounts): number {
  if (!(counts.total > 0)) return 0;
  return (counts.found + counts.userProvided) / counts.total;
}
