import "server-only";

/*
  The run state machine. stepRun does one bounded slice of work on a run
  (discover, a fetch batch loop, an extract batch, or the merge), guarded by
  a lease lock in crawl_runs, and returns the run view. The browser calls it
  in a loop; see PLAN.md, "Long jobs on Vercel".
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
  type PlatformDetection,
  type RankedUrl,
  type UrlCandidate,
} from "@/lib/crawler";
import type { CrawlRunRow, Json, RunCursor, RunLogEntry } from "@/lib/db/types";
import { mergeFindings } from "@/lib/extract/merge";
import { extractPage, type ExtractPageResult } from "@/lib/extract/page";
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
  lockCutoffIso,
  mergeSitePlatform,
  overTextBudget,
  pageKey,
  takeBatch,
  utf8Bytes,
  type StepCursor,
} from "./logic";

export type StepResult = { locked: true; run: RunView } | { locked: false; run: RunView };

type StepContext = {
  db: q.Db;
  /** When this step began; the fetch loop stops starting batches after stepBudgetMs. */
  started: number;
  userId: string;
};

/** What crawl_runs.robots holds. */
type RobotsRecord = {
  raw: string | null;
  sitemaps: string[];
  crawlDelayMs?: number;
  blocked: string[];
};

function toJson(value: unknown): Json {
  return value as Json;
}

function robotsRawOf(robots: Json | null): string | null {
  if (!robots || typeof robots !== "object" || Array.isArray(robots)) return null;
  const raw = robots.raw;
  return typeof raw === "string" ? raw : null;
}

/** The Crawl-delay robots.txt asked for, in milliseconds, capped so a step still makes progress. */
export const MAX_CRAWL_DELAY_MS = 5_000;

function crawlDelayOf(robots: Json | null): number {
  if (!robots || typeof robots !== "object" || Array.isArray(robots)) return 0;
  const ms = robots.crawlDelayMs;
  return typeof ms === "number" && ms > 0 ? Math.min(ms, MAX_CRAWL_DELAY_MS) : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cursorOf(run: CrawlRunRow): StepCursor {
  return { ...(run.cursor && typeof run.cursor === "object" ? run.cursor : {}) };
}

/** The cursor as written to crawl_runs.cursor. */
function storeCursor(cursor: StepCursor): RunCursor {
  return cursor;
}

function nowIso(): string {
  return new Date().toISOString();
}

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
  if (isTerminalStatus(locked.status)) {
    await q.releaseRun(db, runId, token);
    return { locked: false, run: runViewFromRow(locked) };
  }

  let run = locked;
  try {
    if (run.status !== "running" || !run.started_at) {
      run = await q.updateRun(db, runId, { status: "running", started_at: run.started_at ?? startedIso });
    }
    run = await runPhase(run, { db, started, userId });
  } catch (e) {
    run = await recordStepError(db, run, e);
  } finally {
    const closing = run.status === "done" || run.status === "failed";
    await q.releaseRun(db, runId, token, closing && !run.finished_at ? { finished_at: nowIso() } : {});
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
      return run.status === "done" ? run : q.updateRun(ctx.db, run.id, { status: "done", finished_at: run.finished_at ?? nowIso() });
    case "failed":
      return run.status === "failed" ? run : q.updateRun(ctx.db, run.id, { status: "failed", finished_at: run.finished_at ?? nowIso() });
  }
}

/** Logs the error, counts it, and fails the run on the third. The phase is kept so the next call retries. */
async function recordStepError(db: q.Db, run: CrawlRunRow, e: unknown): Promise<CrawlRunRow> {
  const message = errorText(e);
  console.error(`run ${run.id}: step failed in phase ${run.phase}: ${message}`);
  const cursor = cursorOf(run);
  cursor.errorCount = (cursor.errorCount ?? 0) + 1;
  const log = appendLog(run.log, "error", message);
  if (cursor.errorCount >= MAX_STEP_ERRORS) {
    return failRun(db, run, message, cursor, appendLog(log, "error", `The scan stopped after ${MAX_STEP_ERRORS} errors.`));
  }
  return q.updateRun(db, run.id, { cursor, log });
}

/** Marks the run and its project failed with a message a person can read. */
async function failRun(
  db: q.Db,
  run: CrawlRunRow,
  message: string,
  cursor: StepCursor = cursorOf(run),
  log: RunLogEntry[] = appendLog(run.log, "error", message),
): Promise<CrawlRunRow> {
  const updated = await q.updateRun(db, run.id, {
    status: "failed",
    phase: "failed",
    error: message,
    cursor,
    log,
    finished_at: run.finished_at ?? nowIso(),
  });
  try {
    await q.updateProject(db, run.project_id, { status: "failed" });
  } catch (e) {
    console.error(`run ${run.id}: could not mark project failed: ${errorText(e)}`);
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
  });

  const robots: RobotsRecord = {
    raw: discovery.robots.raw,
    sitemaps: discovery.robots.sitemaps,
    ...(discovery.robots.crawlDelayMs !== undefined ? { crawlDelayMs: discovery.robots.crawlDelayMs } : {}),
    blocked: discovery.blockedByRobots,
  };

  if (!discovery.queue.length) {
    const noted = await q.updateRun(db, run.id, { robots: toJson(robots), sitemaps: discovery.sitemapsRead });
    return failRun(db, noted, "The site's robots.txt does not allow its pages to be read.");
  }

  // A retry after a failed write must not trip the unique (run_id, normalized_url) constraint.
  await q.deletePagesForRun(db, run.id);
  await q.insertPages(
    db,
    discovery.queue.map((entry) => pageInsert(entry, run)),
  );

  const cursor: StepCursor = {
    queue: discovery.queue,
    seen: discovery.queue.map((entry) => entry.url),
    usedSitemap: discovery.usedSitemap,
    homeUrl: discovery.home,
    nextRank: discovery.queue.length,
    errorCount: 0,
  };

  let log = appendLog(run.log, "info", discoveryMessage(discovery.usedSitemap, discovery.queue.length));
  if (discovery.blockedByRobots.length) {
    const n = discovery.blockedByRobots.length;
    log = appendLog(log, "warn", `robots.txt blocks ${n} ${n === 1 ? "page" : "pages"}, left out`);
  }

  return q.updateRun(db, run.id, {
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

async function fetchStep(run: CrawlRunRow, ctx: StepContext): Promise<CrawlRunRow> {
  const { db } = ctx;
  const cursor = cursorOf(run);
  let queue: RankedUrl[] = [...(cursor.queue ?? [])];
  const seen = new Set<string>(cursor.seen ?? []);
  const homeUrl = cursor.homeUrl ?? (await q.getProject(db, run.project_id)).site_url;
  const usedSitemap = cursor.usedSitemap ?? true;

  // Every row of the run with its status, not only the queued ones: a retry after a
  // step that failed mid-batch skips the pages that try already wrote instead of
  // inserting them again (unique run_id, normalized_url).
  const rowsByKey = new Map<string, q.PageForFetch>();
  for (const row of await q.listPagesForFetch(db, run.id)) rowsByKey.set(row.normalized_url, row);

  // Links found on pages are only followed when there was no sitemap; robots is re-read from the run.
  let allowed: ((url: string) => boolean) | undefined;
  if (!usedSitemap) {
    try {
      allowed = parseRobots(robotsRawOf(run.robots), new URL(homeUrl).origin, config.crawl.userAgent).allowed;
    } catch {
      allowed = undefined;
    }
  }

  let pagesPlanned = run.pages_planned;
  let pagesFetched = run.pages_fetched;
  let pagesFailed = run.pages_failed;
  let textBytes = Number(run.text_bytes ?? 0);
  let platform: PlatformDetection = { platform: run.platform, evidence: run.platform_evidence ?? [] };
  let log = run.log;
  let budgetWarned = false;

  const fetchOpts = {
    userAgent: config.crawl.userAgent,
    timeoutMs: config.crawl.fetchTimeoutMs,
    maxBytes: config.crawl.maxHtmlBytes,
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
    const batch = taken.batch.filter((entry) => {
      const row = rowsByKey.get(pageKey(entry.url));
      return !row || row.status === "queued";
    });
    if (!batch.length) continue;

    const results = await Promise.all(batch.map((entry) => fetchPage(entry.url, fetchOpts)));
    const detections: PlatformDetection[] = [];
    let read = 0;

    for (let i = 0; i < batch.length; i++) {
      const entry = batch[i];
      const result = results[i];
      const key = pageKey(entry.url);
      let pageId = rowsByKey.get(key)?.id;
      if (!pageId) {
        const [inserted] = await q.insertPages(db, [pageInsert(entry, run)]);
        rowsByKey.set(inserted.normalized_url, { ...inserted, status: "queued" });
        pageId = inserted.id;
      }
      const fetchedAt = nowIso();

      if (!result.ok || result.html === null) {
        pagesFailed++;
        await q.updatePage(db, pageId, {
          status: "failed",
          http_status: result.status || null,
          fetched_at: fetchedAt,
          html_bytes: result.bytes || null,
          error: result.error ?? "fetch failed",
        });
        continue;
      }

      const pageUrl = result.finalUrl || entry.url;
      let cleaned: CleanedPage;
      try {
        cleaned = cleanPage(result.html, pageUrl);
        detections.push(detectPlatform(result.html, pageUrl, { generator: cleaned.generator }));
      } catch (e) {
        // A page the cleaner cannot handle is recorded as failed; it must not stop the run.
        pagesFailed++;
        await q.updatePage(db, pageId, {
          status: "failed",
          http_status: result.status,
          fetched_at: fetchedAt,
          html_bytes: result.bytes,
          error: `clean: ${errorText(e)}`,
        });
        continue;
      }

      const bytes = utf8Bytes(cleaned.text);
      if (overTextBudget(textBytes, bytes, config.crawl.maxTextBytes)) {
        await q.updatePage(db, pageId, {
          status: "skipped",
          http_status: result.status,
          fetched_at: fetchedAt,
          title: cleaned.title,
          html_bytes: result.bytes,
          error: "text budget",
        });
        if (!budgetWarned) {
          log = appendLog(log, "warn", "The text budget for this site is used up; the remaining pages are skipped");
          budgetWarned = true;
        }
        continue;
      }

      const htmlPath = await putHtml(db, { projectId: run.project_id, runId: run.id, pageId, html: result.html });
      await q.updatePage(db, pageId, {
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
        html_path: htmlPath,
        html_bytes: result.bytes,
        jsonld: cleaned.jsonld,
        links: cleaned.links,
        images: cleaned.images,
        error: null,
      });
      pagesFetched++;
      textBytes += bytes;
      read++;

      if (!usedSitemap && pagesPlanned < config.crawl.maxPages) {
        const links: UrlCandidate[] = (cleaned.links.internal ?? []).map((l) =>
          l.text ? { url: l.url, text: l.text } : { url: l.url },
        );
        const added = addDiscoveredLinks(queue, seen, links, {
          home: homeUrl,
          max: config.crawl.maxPages - pagesPlanned,
          nextRank: cursor.nextRank ?? pagesPlanned,
          ...(allowed ? { allowed } : {}),
        });
        if (added.length) {
          const rows = await q.insertPages(
            db,
            added.map((a) => pageInsert(a, run)),
          );
          for (const row of rows) rowsByKey.set(row.normalized_url, { ...row, status: "queued" });
          queue.push(...added);
          for (const a of added) seen.add(a.url);
          cursor.nextRank = (cursor.nextRank ?? pagesPlanned) + added.length;
          pagesPlanned += added.length;
        }
      }
    }

    if (detections.length) platform = mergeSitePlatform(platform, detections);
    log = appendLog(log, "info", fetchBatchMessage(read, pagesPlanned - queue.length, pagesPlanned));

    run = await q.updateRun(db, run.id, {
      cursor: storeCursor({ ...cursor, queue, seen: [...seen], errorCount: 0 }),
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
  const rows = await q.listPagesForOrder(db, run.id);
  const extractQueue = extractOrder(rows);
  if (!extractQueue.length) return failRun(db, run, "None of the pages could be read.");
  const fetched = extractQueue.length;
  const failed = rows.filter((p) => p.status === "failed").length;

  return q.updateRun(db, run.id, {
    phase: "extract",
    cursor: storeCursor({ ...cursorOf(run), queue: [], extractQueue, errorCount: 0 }),
    pages_fetched: fetched,
    pages_failed: failed,
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
    return q.updateRun(db, run.id, {
      phase: "merge",
      cursor: storeCursor({ ...cursor, errorCount: 0 }),
      log: appendLog(run.log, "info", "Putting the fact sheet together"),
    });
  }

  const project = await q.getProject(db, run.project_id);
  const spec = getTemplate(project.template_id);
  const homeUrl = cursor.homeUrl ?? project.site_url;

  const ids = extractQueue.slice(0, config.extract.pagesPerStep);
  const pages = await q.loadPagesForExtract(db, ids);
  const byId = new Map(pages.map((p) => [p.id, p]));

  const outcomes = new Map<string, PromiseSettledResult<ExtractPageResult>>();
  for (const group of chunk(pages, config.extract.parallel)) {
    const settled = await Promise.allSettled(
      group.map((page) =>
        extractPage({
          url: page.url,
          title: page.title,
          text: page.text ?? "",
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
          spec,
          ctx: { userId: ctx.userId, projectId: run.project_id, runId: run.id, purpose: "extract_page" },
        }),
      ),
    );
    group.forEach((page, i) => outcomes.set(page.id, settled[i]));
  }

  // Every page of a batch failing the same way (no API key, the API down) is a step error, not a
  // page error: nothing is written, the queue is kept, and the run fails after the usual three
  // tries. A single page is handled below so one flaky page at the end of the queue cannot fail the run.
  const rejected = [...outcomes.values()].filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (pages.length > 1 && rejected.length === pages.length) {
    throw new Error(`Extraction failed: ${errorText(rejected[0].reason)}`);
  }

  let pagesExtracted = run.pages_extracted;
  let cost = Number(run.cost_usd ?? 0);
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
      await q.updatePage(db, id, {
        status: "extracted",
        findings: r.findings,
        findings_dropped: r.dropped,
        extract_tokens_in: tokensIn,
        extract_tokens_out: r.usage.outputTokens,
        extract_cost_usd: r.costUsd,
        error: null,
      });
      cost += r.costUsd;
      pagesExtracted++;
      extracted++;
    } else {
      const message = errorText(outcome.reason);
      attempts[id] = (attempts[id] ?? 0) + 1;
      if (attempts[id] < config.llm.extractAttempts) {
        // A timeout or a transient API error: the page goes to the back of the queue for one more try.
        retry.push(id);
        log = appendLog(log, "warn", `Could not pull facts from ${page.url} (${message}); will try once more`);
      } else {
        await q.updatePage(db, id, { status: "failed", error: `extraction: ${message}` });
        log = appendLog(log, "warn", `Could not pull facts from ${page.url}: ${message}`);
      }
    }
  }

  const done = new Set(ids);
  const remaining = [...extractQueue.filter((id) => !done.has(id)), ...retry];
  log = appendLog(log, "info", extractBatchMessage(extracted, pagesExtracted, run.pages_fetched));
  const finished = remaining.length === 0;
  if (finished) log = appendLog(log, "info", "Putting the fact sheet together");

  return q.updateRun(db, run.id, {
    ...(finished ? { phase: "merge" as const } : {}),
    cursor: storeCursor({ ...cursor, extractQueue: remaining, extractAttempts: attempts, errorCount: 0 }),
    pages_extracted: pagesExtracted,
    cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
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
  const withFindings = pages.filter((p) => Array.isArray(p.findings));
  const findings = withFindings.flatMap((p) => p.findings ?? []);
  const droppedCount = pages.reduce((n, p) => n + (p.findings_dropped ?? 0), 0);

  const { data, stats } = mergeFindings(spec, findings, { pagesUsed: withFindings.length, droppedCount });
  const existingSchema = existingSchemaOf(pages);

  const version = (await q.maxFactSheetVersion(db, project.id)) + 1;
  const factSheetId = await q.insertFactSheet(db, {
    project_id: project.id,
    user_id: run.user_id,
    version,
    source: "crawl",
    crawl_run_id: run.id,
    template_id: spec.id,
    data,
    existing_schema: existingSchema,
    stats,
  });

  const finishedAt = nowIso();
  const updated = await q.updateRun(db, run.id, {
    fact_sheet_id: factSheetId,
    phase: "done",
    status: "done",
    finished_at: finishedAt,
    pages_extracted: withFindings.length,
    cursor: storeCursor({ ...cursorOf(run), errorCount: 0 }),
    log: appendLog(run.log, "info", factSheetReadyMessage(stats), finishedAt),
  });

  await q.updateProject(db, project.id, {
    status: "review",
    latest_fact_sheet_id: factSheetId,
    business_name: companyNameFrom(data) ?? project.business_name,
    platform: updated.platform,
    platform_evidence: updated.platform_evidence ?? [],
  });

  return updated;
}
