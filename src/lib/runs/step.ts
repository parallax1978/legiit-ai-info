import "server-only";

/*
  The run state machine. stepRun does one bounded slice of work on a run
  (discover, a fetch batch loop, an extract batch, or the merge), guarded by
  a lease lock in crawl_runs, and returns the run view. The browser calls it
  in a loop; see PLAN.md, "Long jobs on Vercel".

  Rules every phase follows, so a step the platform kills at its time limit,
  a transient database error, or a second tab never leaves a run stuck or
  corrupted:
  - The attempt is counted before any work. A phase slice that keeps being
    cut off fails the run after config.crawl.maxStepAttempts instead of
    looping forever.
  - Run writes carry the lock token; a lost lease stops the step. Page writes
    check the lease by time first.
  - Work is rebuilt from the rows, not trusted from the cursor: a retried
    fetch skips pages an earlier try wrote, a retried extract skips pages
    already extracted, a retried merge finds the fact sheet it already wrote.
  - No request starts after config.crawl.stepDeadlineMs.
*/
import { config } from "@/config";
import {
  addDiscoveredLinks,
  cleanPage,
  detectPlatform,
  discoverSite,
  fetchPage,
  parseRobots,
  type CleanedPage,
  type FetchResult,
  type PlatformDetection,
  type RankedUrl,
  type UrlCandidate,
} from "@/lib/crawler";
import type { CrawlRunRow, Json, ProjectRow, RunLogEntry } from "@/lib/db/types";
import type { FactSheetData } from "@/lib/facts/types";
import { mergeFindings } from "@/lib/extract/merge";
import { MIN_TEXT_CHARS, deterministicFindings, extractPage, type ExtractPageResult } from "@/lib/extract/page";
import { StructuredCallError } from "@/lib/llm/client";
import { runViewFromRow, type RunView } from "@/lib/projects/view";
import { putHtml } from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/service";
import { getTemplate } from "@/templates/about-v1";
import * as q from "./db";
import {
  MAX_STEP_ERRORS,
  appendLog,
  chunk,
  companyNameFrom,
  discoveryMessage,
  errorText,
  existingSchemaOf,
  extractBatchMessage,
  extractOrder,
  factSheetReadyMessage,
  fetchBatchMessage,
  isHomePage,
  isTerminalStatus,
  leaseAtRisk,
  lockCutoffIso,
  mergeSitePlatform,
  overTextBudget,
  pageKey,
  projectStatusAfterFailure,
  reconcileFetchState,
  runOwnsProject,
  stalledMessage,
  sumCost,
  takeBatch,
  utf8Bytes,
  type StepCursor,
} from "./logic";

export type StepResult = { locked: true; run: RunView } | { locked: false; run: RunView };

type StepContext = {
  db: q.Db;
  /** When this step began. */
  started: number;
  /** No request starts after this, and request timeouts are cut to fit before it. */
  deadline: number;
  userId: string;
  /** The lock token this step holds; every run write is conditional on it. */
  token: string;
};

/** What crawl_runs.robots holds. */
type RobotsRecord = {
  raw: string | null;
  sitemaps: string[];
  crawlDelayMs?: number;
  blocked: string[];
};

/** Thrown when this step no longer holds the run lock. The step stops without writing. */
class LeaseLostError extends Error {
  constructor() {
    super("The run lock passed to another caller.");
    this.name = "LeaseLostError";
  }
}

/**
 * A model answer that was usable on no try: the same page fails the same way
 * again, so it is not retried. (Timeouts and API errors are.)
 */
function finalExtractionFailure(reason: unknown): boolean {
  return (
    reason instanceof StructuredCallError &&
    (reason.kind === "refusal" || reason.kind === "max_tokens" || reason.kind === "context_window")
  );
}

/** The Crawl-delay robots.txt asked for, in milliseconds, capped so a step still makes progress. */
export const MAX_CRAWL_DELAY_MS = 5_000;

function toJson(value: unknown): Json {
  return value as Json;
}

function robotsRecordOf(robots: Json | null): Partial<RobotsRecord> {
  return robots && typeof robots === "object" && !Array.isArray(robots) ? (robots as Partial<RobotsRecord>) : {};
}

function crawlDelayOf(robots: Json | null): number {
  const ms = robotsRecordOf(robots).crawlDelayMs;
  return typeof ms === "number" && ms > 0 ? Math.min(ms, MAX_CRAWL_DELAY_MS) : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cursorOf(run: CrawlRunRow): StepCursor {
  return { ...(run.cursor && typeof run.cursor === "object" ? run.cursor : {}) };
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Guarded writes
// ---------------------------------------------------------------------------

function assertLease(ctx: StepContext): void {
  if (leaseAtRisk(ctx.started, Date.now(), config.crawl.lockLeaseMs)) throw new LeaseLostError();
}

/** Writes the run while this step still holds the lock; throws LeaseLostError otherwise. */
async function writeRun(ctx: StepContext, runId: string, patch: q.CrawlRunUpdate): Promise<CrawlRunRow> {
  assertLease(ctx);
  const row = await q.updateRunLocked(ctx.db, runId, ctx.token, patch);
  if (!row) throw new LeaseLostError();
  return row;
}

async function writePage(ctx: StepContext, pageId: string, patch: q.CrawlPageUpdate): Promise<void> {
  assertLease(ctx);
  await q.updatePage(ctx.db, pageId, patch);
}

/** A slice finished: the error and attempt counters start over. */
function completed(cursor: StepCursor): StepCursor {
  return { ...cursor, errorCount: 0, attempts: 0 };
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

export async function stepRun(runId: string, userId: string): Promise<StepResult> {
  const db = createServiceClient();
  const started = Date.now();

  const current = await q.getRun(db, runId);
  if (!current || current.user_id !== userId) throw new Error("Run not found");
  if (isTerminalStatus(current.status)) return { locked: false, run: runViewFromRow(current) };

  const token = crypto.randomUUID();
  const startedIso = new Date(started).toISOString();
  const locked = await q.tryLockRun(db, runId, token, lockCutoffIso(started, config.crawl.lockLeaseMs), startedIso);
  if (!locked) {
    const latest = (await q.getRun(db, runId)) ?? current;
    return { locked: true, run: runViewFromRow(latest) };
  }

  const ctx: StepContext = { db, started, deadline: started + config.crawl.stepDeadlineMs, userId, token };
  let run = locked;
  try {
    if (isTerminalStatus(run.status)) return { locked: false, run: runViewFromRow(run) };

    // Count the attempt before doing anything, so a step the platform kills counts too.
    const cursor = cursorOf(run);
    const attempts = (cursor.attempts ?? 0) + 1;
    if (attempts > config.crawl.maxStepAttempts) {
      run = await failRun(ctx, run, stalledMessage(run.phase));
      return { locked: false, run: runViewFromRow(run) };
    }
    run = await writeRun(ctx, runId, {
      status: "running",
      started_at: run.started_at ?? startedIso,
      cursor: { ...cursor, attempts },
    });

    run = await runPhase(run, ctx);
  } catch (e) {
    if (e instanceof LeaseLostError) {
      const latest = (await q.getRun(db, runId).catch(() => null)) ?? run;
      return { locked: true, run: runViewFromRow(latest) };
    }
    run = await recordStepError(ctx, runId, run, e);
  } finally {
    const closing = run.status === "done" || run.status === "failed";
    try {
      await q.releaseRun(db, runId, token, closing && !run.finished_at ? { finished_at: nowIso() } : {});
    } catch (e) {
      // The lease expires on its own; the next step can still take it.
      console.error(`run ${runId}: could not release the lock: ${errorText(e)}`);
    }
  }
  return { locked: false, run: runViewFromRow(run) };
}

async function runPhase(run: CrawlRunRow, ctx: StepContext): Promise<CrawlRunRow> {
  switch (run.phase) {
    case "discover":
      return discoverStep(run, ctx);
    case "fetch":
      return fetchStep(run, ctx);
    case "extract":
      return extractStep(run, ctx);
    case "merge":
      return mergeStep(run, ctx);
    case "done":
      return writeRun(ctx, run.id, {
        status: "done",
        finished_at: run.finished_at ?? nowIso(),
        cursor: completed(cursorOf(run)),
      });
    case "failed":
      return writeRun(ctx, run.id, { status: "failed", finished_at: run.finished_at ?? nowIso() });
  }
}

/**
 * Logs the error, counts it, and fails the run on the third in a row. Reads
 * the run again first, so the batches an earlier part of this step saved are
 * kept, and the phase is left as it is so the next call retries.
 */
async function recordStepError(ctx: StepContext, runId: string, last: CrawlRunRow, e: unknown): Promise<CrawlRunRow> {
  const message = errorText(e);
  console.error(`run ${runId}: step failed in phase ${last.phase}: ${message}`);
  const fresh = (await q.getRun(ctx.db, runId)) ?? last;
  const cursor = cursorOf(fresh);
  const errorCount = (cursor.errorCount ?? 0) + 1;
  const log = appendLog(fresh.log, "error", message);
  try {
    if (errorCount >= MAX_STEP_ERRORS) {
      return await failRun(
        ctx,
        fresh,
        message,
        { ...cursor, errorCount },
        appendLog(log, "error", `The scan stopped after ${MAX_STEP_ERRORS} errors in a row.`),
      );
    }
    return await writeRun(ctx, runId, { cursor: { ...cursor, errorCount }, log });
  } catch (e2) {
    if (e2 instanceof LeaseLostError) return fresh;
    throw e2;
  }
}

/**
 * Marks the run failed with a message a person can read. The project is
 * marked failed only when this run is its latest and it has no fact sheet to
 * fall back on; a failed re-run leaves a reviewed project in review.
 */
async function failRun(
  ctx: StepContext,
  run: CrawlRunRow,
  message: string,
  cursor: StepCursor = cursorOf(run),
  log: RunLogEntry[] = appendLog(run.log, "error", message),
): Promise<CrawlRunRow> {
  const updated = await writeRun(ctx, run.id, {
    status: "failed",
    phase: "failed",
    error: message,
    cursor,
    log,
    finished_at: run.finished_at ?? nowIso(),
  });
  try {
    const project = await q.getProject(ctx.db, run.project_id);
    if (runOwnsProject(project, run.id)) {
      await q.updateProject(ctx.db, project.id, { status: projectStatusAfterFailure(project) });
    }
  } catch (e) {
    console.error(`run ${run.id}: could not update the project after the failure: ${errorText(e)}`);
  }
  return updated;
}

function pageInsert(entry: RankedUrl, run: CrawlRunRow): q.CrawlPageInsert {
  return {
    run_id: run.id,
    project_id: run.project_id,
    user_id: run.user_id,
    url: entry.url,
    normalized_url: pageKey(entry.url),
    rank: entry.rank,
    reason: entry.reason,
    status: "queued",
  };
}

// ---------------------------------------------------------------------------
// discover
// ---------------------------------------------------------------------------

async function discoverStep(run: CrawlRunRow, ctx: StepContext): Promise<CrawlRunRow> {
  const { db } = ctx;
  const project = await q.getProject(db, run.project_id);

  const discovery = await discoverSite(project.site_url, {
    userAgent: config.crawl.userAgent,
    timeoutMs: config.crawl.fetchTimeoutMs,
    maxPages: config.crawl.maxPages,
    maxSitemaps: config.crawl.maxSitemaps,
    maxSitemapUrls: config.crawl.maxSitemapUrls,
    deadline: Math.min(ctx.started + config.crawl.discoverBudgetMs, ctx.deadline),
  });

  const robots: RobotsRecord = {
    raw: discovery.robots.raw,
    sitemaps: discovery.robots.sitemaps,
    ...(discovery.robots.crawlDelayMs !== undefined ? { crawlDelayMs: discovery.robots.crawlDelayMs } : {}),
    blocked: discovery.blockedByRobots,
  };

  if (!discovery.queue.length) {
    const noted = await writeRun(ctx, run.id, { robots: toJson(robots), sitemaps: discovery.sitemapsRead });
    return failRun(ctx, noted, "The site's robots.txt does not allow its pages to be read.");
  }

  // A retry of discovery starts the page list over.
  assertLease(ctx);
  await q.deletePagesForRun(db, run.id);
  await q.insertPages(
    db,
    discovery.queue.map((entry) => pageInsert(entry, run)),
  );

  const cursor: StepCursor = completed({
    queue: discovery.queue,
    seen: discovery.queue.map((entry) => entry.url),
    usedSitemap: discovery.usedSitemap,
    homeUrl: discovery.home,
    nextRank: discovery.queue.length,
  });

  let log = appendLog(run.log, "info", discoveryMessage(discovery.usedSitemap, discovery.queue.length));
  if (discovery.blockedByRobots.length) {
    const n = discovery.blockedByRobots.length;
    log = appendLog(log, "warn", `robots.txt blocks ${n} ${n === 1 ? "page" : "pages"}, left out`);
  }

  return writeRun(ctx, run.id, {
    phase: "fetch",
    cursor,
    pages_planned: discovery.queue.length,
    pages_fetched: 0,
    pages_failed: 0,
    text_bytes: 0,
    robots: toJson(robots),
    sitemaps: discovery.sitemapsRead,
    log,
  });
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

/** The error recorded on a page skipped because the run's text budget ran out. */
const TEXT_BUDGET = "text budget";

type Prepared = {
  entry: RankedUrl;
  pageId: string;
  result: FetchResult;
  cleaned: CleanedPage | null;
  /** Why the page is not stored with text. */
  problem: { status: "failed" | "skipped"; error: string } | null;
};

async function fetchStep(run: CrawlRunRow, ctx: StepContext): Promise<CrawlRunRow> {
  const { db } = ctx;
  const cursor = cursorOf(run);
  const homeUrl = cursor.homeUrl ?? (await q.getProject(db, run.project_id)).site_url;
  const usedSitemap = cursor.usedSitemap ?? true;

  // The rows decide what is left; see reconcileFetchState.
  const rowsByKey = new Map<string, q.PageForFetch>();
  const rows = await q.listPagesForFetch(db, run.id);
  for (const row of rows) rowsByKey.set(row.normalized_url, row);
  const state = reconcileFetchState(cursor, rows);

  let queue: RankedUrl[] = state.queue;
  const seen = new Set<string>(state.seen);
  let nextRank = Math.max(state.nextRank, cursor.nextRank ?? 0);
  let pagesPlanned = state.planned;
  let pagesFetched = state.fetched;
  let pagesFailed = state.failed;
  let textBytes = Math.max(Number(run.text_bytes ?? 0), state.textChars);
  let platform: PlatformDetection = { platform: run.platform, evidence: run.platform_evidence ?? [] };
  let log = run.log;
  let budgetWarned = false;

  // robots.txt as read at discovery, re-read from the run: every fetch and every redirect hop is checked.
  let robotsAllowed: ((url: string) => boolean) | undefined;
  try {
    const raw = robotsRecordOf(run.robots).raw ?? null;
    robotsAllowed = parseRobots(raw, new URL(homeUrl).origin, config.crawl.userAgent).allowed;
  } catch {
    robotsAllowed = undefined;
  }
  // Links found on pages are only followed when there was no sitemap.
  const allowed = usedSitemap ? undefined : robotsAllowed;

  const fetchOpts = {
    userAgent: config.crawl.userAgent,
    timeoutMs: config.crawl.fetchTimeoutMs,
    maxBytes: config.crawl.maxHtmlBytes,
    // Leaves time for the uploads and writes after the last batch.
    deadline: ctx.deadline - config.crawl.writeReserveMs,
    ...(robotsAllowed ? { allowed: robotsAllowed } : {}),
  };

  // A site that asks for a Crawl-delay is read one page at a time with that pause between pages.
  const crawlDelayMs = crawlDelayOf(run.robots);
  const parallel = crawlDelayMs > 0 ? 1 : config.crawl.parallel;
  let batches = 0;

  while (queue.length && Date.now() - ctx.started < config.crawl.stepBudgetMs) {
    if (crawlDelayMs > 0 && batches > 0) await sleep(crawlDelayMs);
    batches++;
    const taken = takeBatch(queue, parallel);
    queue = taken.rest;

    // Every entry gets its row before the fetch, so a page id exists for the upload path.
    const missing = taken.batch.filter((entry) => !rowsByKey.has(pageKey(entry.url)));
    if (missing.length) {
      assertLease(ctx);
      for (const inserted of await q.insertNewPages(db, missing.map((entry) => pageInsert(entry, run)))) {
        rowsByKey.set(inserted.normalized_url, { ...inserted, status: "queued", reason: null, text_chars: 0 });
      }
    }
    const batch = taken.batch.filter((entry) => rowsByKey.get(pageKey(entry.url))?.status === "queued");
    if (!batch.length) continue;

    const results = await Promise.all(batch.map((entry) => fetchPage(entry.url, fetchOpts)));
    const detections: PlatformDetection[] = [];

    // A page that redirects to another page of this run ("/about" to "/about-us/") is read once,
    // under the address it lands on, unless that page could not be read.
    const readInBatch = new Set(batch.filter((_, i) => results[i].ok).map((entry) => pageKey(entry.url)));
    const sameAs = (entry: RankedUrl, landedUrl: string): string | null => {
      const landedKey = pageKey(landedUrl);
      if (landedKey === pageKey(entry.url)) return null;
      const twin = rowsByKey.get(landedKey);
      if (!twin) return null;
      if (twin.status === "fetched" || twin.status === "extracted") return twin.url;
      if (twin.status !== "queued") return null;
      const inBatch = batch.some((e) => pageKey(e.url) === landedKey);
      return !inBatch || readInBatch.has(landedKey) ? twin.url : null;
    };

    // Clean each page and apply the text budget, in rank order.
    const prepared: Prepared[] = batch.map((entry, i) => {
      const result = results[i];
      const pageId = rowsByKey.get(pageKey(entry.url))!.id;
      if (!result.ok || result.html === null) {
        return { entry, pageId, result, cleaned: null, problem: { status: "failed", error: result.error ?? "fetch failed" } };
      }
      const pageUrl = result.finalUrl || entry.url;
      const twin = sameAs(entry, pageUrl);
      if (twin) return { entry, pageId, result, cleaned: null, problem: { status: "skipped", error: `same page as ${twin}` } };
      try {
        const cleaned = cleanPage(result.html, pageUrl);
        detections.push(detectPlatform(result.html, pageUrl, { generator: cleaned.generator }));
        const bytes = utf8Bytes(cleaned.text);
        if (overTextBudget(textBytes, bytes, config.crawl.maxTextBytes)) {
          return { entry, pageId, result, cleaned, problem: { status: "skipped", error: TEXT_BUDGET } };
        }
        textBytes += bytes;
        return { entry, pageId, result, cleaned, problem: null };
      } catch (e) {
        // A page the cleaner cannot handle is recorded as failed; it must not stop the run.
        return { entry, pageId, result, cleaned: null, problem: { status: "failed", error: `clean: ${errorText(e)}` } };
      }
    });

    // Uploads run side by side; a failed upload only leaves html_path empty.
    const htmlPaths = await Promise.all(
      prepared.map((p) =>
        p.problem === null && p.result.html !== null
          ? putHtml(db, { projectId: run.project_id, runId: run.id, pageId: p.pageId, html: p.result.html })
          : Promise.resolve(null),
      ),
    );

    let read = 0;
    for (let i = 0; i < prepared.length; i++) {
      const { entry, pageId, result, cleaned, problem } = prepared[i];
      const fetchedAt = nowIso();
      const key = pageKey(entry.url);

      if (problem?.status === "skipped") {
        await writePage(ctx, pageId, {
          status: "skipped",
          http_status: result.status,
          fetched_at: fetchedAt,
          title: cleaned?.title ?? null,
          html_bytes: result.bytes,
          error: problem.error,
        });
        rowsByKey.set(key, { ...rowsByKey.get(key)!, status: "skipped" });
        if (problem.error === TEXT_BUDGET && !budgetWarned) {
          log = appendLog(log, "warn", "The text budget for this site is used up; the remaining pages are skipped");
          budgetWarned = true;
        }
        continue;
      }
      if (problem?.status === "failed" || !cleaned) {
        pagesFailed++;
        await writePage(ctx, pageId, {
          status: "failed",
          http_status: result.status || null,
          fetched_at: fetchedAt,
          html_bytes: result.bytes || null,
          error: problem?.error ?? "fetch failed",
        });
        rowsByKey.set(key, { ...rowsByKey.get(key)!, status: "failed" });
        continue;
      }

      await writePage(ctx, pageId, {
        status: "fetched",
        http_status: result.status,
        fetched_at: fetchedAt,
        title: cleaned.title,
        meta_description: cleaned.metaDescription,
        canonical: cleaned.canonical,
        lang: cleaned.lang,
        text: cleaned.text,
        text_chars: cleaned.textChars,
        headings: cleaned.headings,
        html_path: htmlPaths[i],
        html_bytes: result.bytes,
        jsonld: cleaned.jsonld,
        links: cleaned.links,
        images: cleaned.images,
        error: null,
      });
      rowsByKey.set(key, { ...rowsByKey.get(key)!, status: "fetched", text_chars: cleaned.textChars });
      // A link to the address this page redirected to is the same page, so it is not queued again.
      if (result.finalUrl && pageKey(result.finalUrl) !== key) seen.add(result.finalUrl);
      pagesFetched++;
      read++;

      if (!usedSitemap && pagesPlanned < config.crawl.maxPages) {
        const links: UrlCandidate[] = (cleaned.links.internal ?? []).map((l) =>
          l.text ? { url: l.url, text: l.text } : { url: l.url },
        );
        const added = addDiscoveredLinks(queue, seen, links, {
          home: homeUrl,
          max: config.crawl.maxPages - pagesPlanned,
          nextRank,
          ...(allowed ? { allowed } : {}),
        }).filter((a) => !rowsByKey.has(pageKey(a.url)));
        if (added.length) {
          assertLease(ctx);
          const inserted = await q.insertNewPages(db, added.map((a) => pageInsert(a, run)));
          const insertedKeys = new Set(inserted.map((r) => r.normalized_url));
          for (const r of inserted) rowsByKey.set(r.normalized_url, { ...r, status: "queued", reason: null, text_chars: 0 });
          for (const a of added) {
            seen.add(a.url);
            if (insertedKeys.has(pageKey(a.url))) queue.push(a);
          }
          nextRank = Math.max(nextRank, ...added.map((a) => a.rank + 1));
          pagesPlanned += inserted.length;
        }
      }
    }

    if (detections.length) platform = mergeSitePlatform(platform, detections);
    log = appendLog(log, "info", fetchBatchMessage(read, pagesPlanned - queue.length, pagesPlanned));

    run = await writeRun(ctx, run.id, {
      cursor: completed({ ...cursor, queue, seen: [...seen], nextRank }),
      pages_planned: pagesPlanned,
      pages_fetched: pagesFetched,
      pages_failed: pagesFailed,
      text_bytes: textBytes,
      platform: platform.platform,
      platform_evidence: platform.evidence,
      log,
    });
  }

  if (queue.length) return run;

  // Counted from the rows, so pages written by an earlier try of this step are in the totals.
  const finalRows = await q.listPagesForOrder(db, run.id);
  const extractQueue = extractOrder(finalRows);
  if (!extractQueue.length) return failRun(ctx, run, "None of the pages could be read.");
  const fetched = extractQueue.length;

  return writeRun(ctx, run.id, {
    phase: "extract",
    cursor: completed({ ...cursorOf(run), queue: [], extractQueue }),
    pages_planned: finalRows.length,
    pages_fetched: fetched,
    pages_failed: finalRows.filter((p) => p.status === "failed").length,
    log: appendLog(run.log, "info", `Read ${fetched} ${fetched === 1 ? "page" : "pages"}, pulling the facts next`),
  });
}

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------

async function extractStep(run: CrawlRunRow, ctx: StepContext): Promise<CrawlRunRow> {
  const { db } = ctx;
  const cursor = cursorOf(run);
  const extractQueue = [...(cursor.extractQueue ?? [])];

  if (!extractQueue.length) {
    return writeRun(ctx, run.id, {
      phase: "merge",
      cursor: completed(cursor),
      log: appendLog(run.log, "info", "Putting the fact sheet together"),
    });
  }

  const project = await q.getProject(db, run.project_id);
  const spec = getTemplate(project.template_id);
  const homeUrl = cursor.homeUrl ?? project.site_url;

  const ids = extractQueue.slice(0, config.extract.pagesPerStep);
  const loaded = await q.loadPagesForExtract(db, ids);
  // A page an earlier, cut-off try already finished is not sent to the model again.
  const pages = loaded.filter((p) => p.status === "fetched");
  const byId = new Map(loaded.map((p) => [p.id, p]));

  const inputOf = (page: q.PageForExtract) => ({
    url: page.url,
    jsonld: Array.isArray(page.jsonld) ? page.jsonld : [],
    links: page.links ?? {},
    images: Array.isArray(page.images) ? page.images : [],
    cleanedMeta: {
      title: page.title,
      metaDescription: page.meta_description,
      canonical: page.canonical,
      lang: page.lang,
    },
    isHome: isHomePage(page.url, homeUrl),
  });

  const outcomes = new Map<string, PromiseSettledResult<ExtractPageResult>>();
  for (const group of chunk(pages, config.extract.parallel)) {
    const settled = await Promise.allSettled(
      group.map((page) =>
        extractPage({
          ...inputOf(page),
          title: page.title,
          text: page.text ?? "",
          spec,
          ctx: { userId: ctx.userId, projectId: run.project_id, runId: run.id, purpose: "extract_page" },
        }),
      ),
    );
    group.forEach((page, i) => outcomes.set(page.id, settled[i]));
  }

  // Every request of a batch failing (no API key, the API down) is a step error, not a page
  // error: nothing is written, the queue is kept, and the run fails after the usual three tries.
  // Answers the model gave but that could not be used are page problems and are handled below,
  // as is a single page, so one flaky page at the end of the queue cannot fail the run.
  const rejected = [...outcomes.values()].filter((r): r is PromiseRejectedResult => r.status === "rejected");
  const requestFailures = rejected.filter((r) => !(r.reason instanceof StructuredCallError));
  // Pages too short for a model call succeed without one, so they say nothing about an outage.
  const needModel = pages.filter((p) => (p.text ?? "").trim().length >= MIN_TEXT_CHARS).length;
  if (needModel > 1 && requestFailures.length === needModel) {
    throw new Error(`Extraction failed: ${errorText(rejected[0].reason)}`);
  }

  let log = run.log;
  let extracted = 0;
  const attempts: Record<string, number> = { ...(cursor.extractAttempts ?? {}) };
  const retry: string[] = [];

  for (const id of ids) {
    const page = byId.get(id);
    const outcome = outcomes.get(id);
    if (!page || !outcome) continue;

    if (outcome.status === "fulfilled") {
      const r = outcome.value;
      const tokensIn = r.usage.inputTokens + (r.usage.cacheReadTokens ?? 0) + (r.usage.cacheWriteTokens ?? 0);
      await writePage(ctx, id, {
        status: "extracted",
        findings: r.findings,
        findings_dropped: r.dropped,
        extract_tokens_in: tokensIn,
        extract_tokens_out: r.usage.outputTokens,
        extract_cost_usd: r.costUsd,
        error: null,
      });
      extracted++;
    } else {
      const message = errorText(outcome.reason);
      attempts[id] = (attempts[id] ?? 0) + 1;
      if (attempts[id] < config.llm.extractAttempts && !finalExtractionFailure(outcome.reason)) {
        // A timeout or a transient API error: the page goes to the back of the queue for one more try.
        retry.push(id);
        log = appendLog(log, "warn", `Could not pull facts from ${page.url} (${message}); will try once more`);
      } else {
        // The model could not read it, but its JSON-LD, links, and canonical still count.
        await writePage(ctx, id, {
          status: "failed",
          findings: deterministicFindings(inputOf(page)),
          findings_dropped: 0,
          error: `extraction: ${message}`,
        });
        log = appendLog(log, "warn", `Could not pull facts from ${page.url}: ${message}`);
      }
    }
  }

  const done = new Set(ids);
  const remaining = [...extractQueue.filter((id) => !done.has(id)), ...retry];

  // Counters and cost come from the rows and llm_calls, which a cut-off try cannot leave behind.
  const rows = await q.listPagesForOrder(db, run.id);
  const pagesExtracted = rows.filter((p) => p.status === "extracted").length;
  const cost = sumCost(await q.runLlmCosts(db, run.id));

  log = appendLog(log, "info", extractBatchMessage(extracted, pagesExtracted, run.pages_fetched));
  const finished = remaining.length === 0;
  if (finished) log = appendLog(log, "info", "Putting the fact sheet together");

  return writeRun(ctx, run.id, {
    ...(finished ? { phase: "merge" as const } : {}),
    cursor: completed({ ...cursor, extractQueue: remaining, extractAttempts: attempts }),
    pages_extracted: pagesExtracted,
    cost_usd: cost,
    log,
  });
}

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

async function mergeStep(run: CrawlRunRow, ctx: StepContext): Promise<CrawlRunRow> {
  const { db } = ctx;
  const project = await q.getProject(db, run.project_id);
  const spec = getTemplate(project.template_id);

  const pages = await q.loadPagesForMerge(db, run.id);
  // Pages the model actually read. A page too short for a model call is "extracted" without one.
  const modelPages = pages.filter((p) => p.status === "extracted" && (p.extract_tokens_out ?? 0) > 0).length;
  const readable = pages.some((p) => (p.text_chars ?? 0) >= MIN_TEXT_CHARS);
  if (modelPages === 0 && readable) {
    // The site has text but no page reached the model (an outage, a bad key): a fact sheet of
    // JSON-LD and links alone would read as "the site says nothing", so it is a failed scan.
    return failRun(ctx, run, "The facts could not be read from any page. Run the scan again in a few minutes.");
  }

  const withFindings = pages.filter((p) => Array.isArray(p.findings));
  const findings = withFindings.flatMap((p) => p.findings ?? []);
  const droppedCount = pages.reduce((n, p) => n + (p.findings_dropped ?? 0), 0);
  const { data, stats } = mergeFindings(spec, findings, { pagesUsed: withFindings.length, droppedCount });

  const factSheetId = await ensureFactSheet(ctx, run, project, {
    template_id: spec.id,
    data,
    existing_schema: existingSchemaOf(pages),
    stats,
  });

  // The project first, then the run: a retry after a cut-off here redoes both and
  // reuses the sheet, so the project can never be left pointing nowhere.
  await syncProject(ctx, run, project, factSheetId, data);

  const finishedAt = nowIso();
  return writeRun(ctx, run.id, {
    fact_sheet_id: factSheetId,
    phase: "done",
    status: "done",
    finished_at: finishedAt,
    pages_extracted: pages.filter((p) => p.status === "extracted").length,
    cursor: completed(cursorOf(run)),
    log: appendLog(run.log, "info", factSheetReadyMessage(stats), finishedAt),
  });
}

/** The run's fact sheet: the one an earlier try wrote, or a new version. */
async function ensureFactSheet(
  ctx: StepContext,
  run: CrawlRunRow,
  project: ProjectRow,
  sheet: Pick<q.FactSheetInsert, "template_id" | "data" | "existing_schema" | "stats">,
): Promise<string> {
  const { db } = ctx;
  const existing = run.fact_sheet_id ?? (await q.factSheetIdForRun(db, run.id));
  if (existing) return existing;

  assertLease(ctx);
  const version = (await q.maxFactSheetVersion(db, project.id)) + 1;
  try {
    return await q.insertFactSheet(db, {
      project_id: project.id,
      user_id: run.user_id,
      version,
      source: "crawl",
      crawl_run_id: run.id,
      ...sheet,
    });
  } catch (e) {
    // The unique index on crawl_run_id: a try that was cut off wrote it after all.
    if (e instanceof q.DbError && e.code === "23505") {
      const written = await q.factSheetIdForRun(db, run.id);
      if (written) return written;
    }
    throw e;
  }
}

/** Points the project at this run's fact sheet, unless a newer run has taken the project over. */
async function syncProject(
  ctx: StepContext,
  run: CrawlRunRow,
  project: ProjectRow,
  factSheetId: string,
  data: FactSheetData,
): Promise<void> {
  if (!runOwnsProject(project, run.id)) return;
  assertLease(ctx);
  await q.updateProject(ctx.db, project.id, {
    status: "review",
    latest_crawl_run_id: run.id,
    latest_fact_sheet_id: factSheetId,
    business_name: companyNameFrom(data) ?? project.business_name,
    platform: run.platform,
    platform_evidence: run.platform_evidence ?? [],
  });
}
