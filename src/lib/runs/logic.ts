/*
  Pure helpers for the run state machine: the lock cutoff, queue batching,
  the text-budget decision, log entries, platform evidence across pages, and
  the small mappings the phases share. Nothing here imports server-only code,
  next/headers, or Supabase, so vitest runs it in node.
*/
import { mergePlatformEvidence, type PlatformDetection } from "@/lib/crawler/platform";
import { urlKey } from "@/lib/crawler/url";
import type { RankedUrl } from "@/lib/crawler/url";
import type {
  CrawlPageRow,
  JsonLdBlock,
  PlatformEvidence,
  PlatformT,
  ProjectRow,
  ProjectStatusT,
  RunCursor,
  RunLogEntry,
  RunPhaseT,
  RunStatusT,
} from "@/lib/db/types";
import type { FactSheetData, FactSheetStats } from "@/lib/facts/types";

/** Errors a run may hit before it is marked failed. Reset by a slice that succeeds. */
export const MAX_STEP_ERRORS = 3;

/** Log entries kept on a run; the oldest are dropped first. */
export const MAX_LOG_ENTRIES = 300;

/** The step state as the run machine reads and writes it, errorCount included. */
export type StepCursor = RunCursor;

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

/** The lock is free when locked_at is null or older than this instant. */
export function lockCutoffIso(nowMs: number, leaseMs: number): string {
  return new Date(nowMs - leaseMs).toISOString();
}

/** The PostgREST `or` filter for a free or expired lock. The timestamp is quoted. */
export function lockFilter(cutoffIso: string): string {
  return `locked_at.is.null,locked_at.lt."${cutoffIso}"`;
}

export function isTerminalStatus(status: RunStatusT): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

/** The next `size` entries and what is left. */
export function takeBatch<T>(queue: readonly T[], size: number): { batch: T[]; rest: T[] } {
  const n = Math.max(0, Math.floor(size));
  return { batch: queue.slice(0, n), rest: queue.slice(n) };
}

/** Splits a list into runs of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** crawl_pages ids of the fetched pages in rank order: the extract queue. */
export function extractOrder(pages: Pick<CrawlPageRow, "id" | "rank" | "status">[]): string[] {
  return pages
    .filter((p) => p.status === "fetched")
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .map((p) => p.id);
}

// ---------------------------------------------------------------------------
// Text budget
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/** True when storing this page would push the site past its text budget. */
export function overTextBudget(currentBytes: number, pageBytes: number, maxBytes: number): boolean {
  return currentBytes + pageBytes > maxBytes;
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

export function appendLog(
  log: RunLogEntry[] | null | undefined,
  level: RunLogEntry["level"],
  message: string,
  at: string = new Date().toISOString(),
): RunLogEntry[] {
  const next = [...(Array.isArray(log) ? log : []), { at, level, message }];
  return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function discoveryMessage(usedSitemap: boolean, count: number): string {
  if (usedSitemap) return `Found ${count} ${plural(count, "page", "pages")} from the sitemap`;
  return "No sitemap, following links from the home page";
}

/** "Read 6 pages (12 of 31)". */
export function fetchBatchMessage(read: number, done: number, planned: number): string {
  return `Read ${read} ${plural(read, "page", "pages")} (${done} of ${planned})`;
}

/** "Pulled facts from 4 pages (8 of 31)". */
export function extractBatchMessage(extracted: number, done: number, total: number): string {
  return `Pulled facts from ${extracted} ${plural(extracted, "page", "pages")} (${done} of ${total})`;
}

/** "Fact sheet ready: 31 found, 3 contradicted, 12 missing". */
/** The run log line for the owner's edits that carried onto the new fact sheet. */
export function carriedMessage(count: number): string {
  return count === 1 ? "Kept the field you edited on the last fact sheet." : `Kept the ${count} fields you edited on the last fact sheet.`;
}

export function factSheetReadyMessage(stats: Pick<FactSheetStats, "found" | "conflict" | "missing">): string {
  return `Fact sheet ready: ${stats.found} found, ${stats.conflict} contradicted, ${stats.missing} missing`;
}

/** A short message for the log and the run's error column. Never a stack trace. */
export function errorText(e: unknown): string {
  let message: string;
  if (e instanceof Error) message = e.message;
  else if (typeof e === "string") message = e;
  else message = "Unknown error";
  message = message.replace(/\s+/g, " ").trim() || "Unknown error";
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

/**
 * Folds the detections from a batch of pages into the run's current platform
 * and evidence. What the run already holds counts like one more page, so a
 * later batch with weaker signals does not flip the answer.
 */
export function mergeSitePlatform(
  current: { platform: PlatformT; evidence: PlatformEvidence[] },
  detections: PlatformDetection[],
): PlatformDetection {
  if (!detections.length) return { platform: current.platform, evidence: current.evidence ?? [] };
  return mergePlatformEvidence([{ platform: current.platform, evidence: current.evidence ?? [] }, ...detections]);
}

// ---------------------------------------------------------------------------
// Pages and the fact sheet
// ---------------------------------------------------------------------------

/** Same page as the site's home page, ignoring scheme, www, and the trailing slash. */
export function isHomePage(url: string, homeUrl: string | null | undefined): boolean {
  if (!homeUrl) return false;
  const a = urlKey(url);
  const b = urlKey(homeUrl);
  return a !== null && a === b;
}

/** The dedupe key stored in crawl_pages.normalized_url. */
export function pageKey(url: string): string {
  return urlKey(url) ?? url;
}

export type ExistingSchemaBlock = JsonLdBlock & { url: string };

/** Every JSON-LD block from every page with the page URL attached. */
export function existingSchemaOf(pages: Pick<CrawlPageRow, "url" | "jsonld">[]): ExistingSchemaBlock[] {
  const out: ExistingSchemaBlock[] = [];
  for (const page of pages) {
    const blocks = Array.isArray(page.jsonld) ? page.jsonld : [];
    for (const block of blocks) out.push({ url: page.url, ...block });
  }
  return out;
}

/** The company name the fact sheet found, when it is a plain string. */
export function companyNameFrom(data: FactSheetData): string | null {
  const field = data.fields?.company_name;
  if (!field || typeof field.value !== "string") return null;
  const name = field.value.trim();
  return name ? name.slice(0, 200) : null;
}

/** The columns copied when a new run reuses the pages of an earlier one. */
export type ReusablePage = Pick<
  CrawlPageRow,
  | "url"
  | "normalized_url"
  | "rank"
  | "reason"
  | "title"
  | "meta_description"
  | "canonical"
  | "lang"
  | "text"
  | "text_chars"
  | "headings"
  | "html_path"
  | "html_bytes"
  | "jsonld"
  | "links"
  | "images"
>;

export type ReusedPageRow = ReusablePage & {
  run_id: string;
  project_id: string;
  user_id: string;
  status: "fetched";
  http_status: number | null;
  fetched_at: string;
  findings: null;
  findings_dropped: 0;
  error: null;
};

/** A fetched page copied into a new run: text and extraction inputs kept, findings reset. */
export function reusedPageRow(
  page: ReusablePage & Partial<Pick<CrawlPageRow, "http_status" | "fetched_at">>,
  target: { runId: string; projectId: string; userId: string },
  now: string = new Date().toISOString(),
): ReusedPageRow {
  return {
    run_id: target.runId,
    project_id: target.projectId,
    user_id: target.userId,
    url: page.url,
    normalized_url: page.normalized_url,
    rank: page.rank,
    reason: page.reason,
    status: "fetched",
    http_status: page.http_status ?? null,
    fetched_at: page.fetched_at ?? now,
    title: page.title,
    meta_description: page.meta_description,
    canonical: page.canonical,
    lang: page.lang,
    text: page.text,
    text_chars: page.text_chars,
    headings: Array.isArray(page.headings) ? page.headings : [],
    html_path: page.html_path,
    html_bytes: page.html_bytes,
    jsonld: Array.isArray(page.jsonld) ? page.jsonld : [],
    links: page.links ?? {},
    images: Array.isArray(page.images) ? page.images : [],
    findings: null,
    findings_dropped: 0,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Attempts and time
// ---------------------------------------------------------------------------

const PHASE_WORDS: Record<RunPhaseT, string> = {
  discover: "finding the pages",
  fetch: "reading the pages",
  extract: "pulling the facts",
  merge: "putting the fact sheet together",
  done: "finishing",
  failed: "finishing",
};

/** Why a run failed when its steps kept being cut off before they finished. */
export function stalledMessage(phase: RunPhaseT): string {
  return `The scan kept running out of time while ${PHASE_WORDS[phase]}. Try it again later.`;
}

/** True when a step has run long enough that its lock lease may have passed to another caller. */
export function leaseAtRisk(startedMs: number, nowMs: number, leaseMs: number, marginMs = 5_000): boolean {
  return nowMs - startedMs > leaseMs - marginMs;
}

// ---------------------------------------------------------------------------
// Fetch state
// ---------------------------------------------------------------------------

export type PageRowForFetch = Pick<
  CrawlPageRow,
  "id" | "url" | "normalized_url" | "rank" | "status" | "reason" | "text_chars"
>;

export type FetchState = {
  /** Pages still to fetch, in rank order. */
  queue: RankedUrl[];
  /** Every URL planned so far, for the link dedupe. */
  seen: string[];
  planned: number;
  fetched: number;
  failed: number;
  nextRank: number;
  /** Characters of stored text, a lower bound on its bytes. */
  textChars: number;
};

const READ = new Set(["fetched", "extracted"]);

/**
 * The fetch phase's work rebuilt from the page rows instead of trusted from
 * the cursor. A step that died after writing rows but before saving the
 * cursor leaves pages it already fetched (skipped here) and queued rows for
 * links it found (added here). Rows decide what is left; the cursor only
 * contributes order and reasons.
 */
export function reconcileFetchState(cursor: Pick<RunCursor, "queue" | "seen">, rows: PageRowForFetch[]): FetchState {
  const byKey = new Map(rows.map((r) => [r.normalized_url, r]));
  const queue: RankedUrl[] = [];
  const queued = new Set<string>();

  for (const entry of cursor.queue ?? []) {
    const key = pageKey(entry.url);
    const row = byKey.get(key);
    if ((row && row.status !== "queued") || queued.has(key)) continue;
    queued.add(key);
    queue.push(row ? { url: row.url, rank: row.rank, reason: entry.reason } : entry);
  }
  for (const row of rows) {
    if (row.status !== "queued" || queued.has(row.normalized_url)) continue;
    queued.add(row.normalized_url);
    queue.push({ url: row.url, rank: row.rank, reason: row.reason ?? "linked from a page" });
  }
  queue.sort((a, b) => a.rank - b.rank);

  const seen = new Set<string>(cursor.seen ?? []);
  for (const row of rows) seen.add(row.url);
  for (const entry of queue) seen.add(entry.url);

  const planned = new Set<string>([...byKey.keys(), ...queued]);
  const ranks = [...rows.map((r) => r.rank), ...queue.map((e) => e.rank)];
  return {
    queue,
    seen: [...seen],
    planned: planned.size,
    fetched: rows.filter((r) => READ.has(r.status)).length,
    failed: rows.filter((r) => r.status === "failed").length,
    nextRank: (ranks.length ? Math.max(...ranks) : -1) + 1,
    textChars: rows.reduce((n, r) => n + (READ.has(r.status) ? (r.text_chars ?? 0) : 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Project pointers
// ---------------------------------------------------------------------------

/** A run updates the project only while it is the project's latest run. */
export function runOwnsProject(project: Pick<ProjectRow, "latest_crawl_run_id">, runId: string): boolean {
  return !project.latest_crawl_run_id || project.latest_crawl_run_id === runId;
}

/** After a failed run, a project that still has a fact sheet stays in review. */
export function projectStatusAfterFailure(project: Pick<ProjectRow, "latest_fact_sheet_id">): ProjectStatusT {
  return project.latest_fact_sheet_id ? "review" : "failed";
}

/** Total of a list of llm_calls costs, rounded to the column's six decimals. */
export function sumCost(rows: { cost_usd: number | string | null }[]): number {
  const total = rows.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0);
  return Math.round(total * 1_000_000) / 1_000_000;
}
