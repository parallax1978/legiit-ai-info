import "server-only";

/*
  Starts a crawl run for a project. With reusePages, the fetched pages of the
  most recent run that still holds text are copied into the new run and it
  starts at the extract phase; otherwise it starts at discover.
*/
import { normalizeSiteUrl } from "@/lib/crawler/url";
import type { CrawlRunRow, ProjectRow } from "@/lib/db/types";
import * as q from "./db";
import { appendLog, reusedPageRow, utf8Bytes, type StepCursor } from "./logic";

export interface CreateRunOptions {
  reusePages?: boolean;
}

function homeUrlOf(project: ProjectRow): string {
  try {
    return normalizeSiteUrl(project.site_url);
  } catch {
    return project.site_url;
  }
}

/**
 * Inserts the run, copies pages when asked and possible, points the project
 * at the run, and records the usage event. Returns the run row.
 */
export async function createRun(
  db: q.Db,
  project: ProjectRow,
  userId: string,
  opts: CreateRunOptions = {},
): Promise<CrawlRunRow> {
  const now = new Date().toISOString();

  let source: { runId: string; pages: q.ReusablePageRow[] } | null = null;
  if (opts.reusePages) {
    const sourceRunId = await q.latestReusableRunId(db, project.id);
    if (sourceRunId) {
      const pages = await q.listReusablePages(db, sourceRunId);
      if (pages.length) source = { runId: sourceRunId, pages };
    }
  }

  const homeUrl = homeUrlOf(project);
  const cursor: StepCursor = { homeUrl, errorCount: 0 };
  // Inserted at discover even when pages will be reused: the run only moves to
  // extract once its pages and queue are in place, so a half-made reuse run can
  // never be stepped into an empty merge.
  let run = await q.insertRun(db, {
    project_id: project.id,
    user_id: userId,
    status: "queued",
    phase: "discover",
    cursor,
    log: [],
  });

  try {
    if (source) run = await copyPages(db, run, project, userId, source, homeUrl, cursor, now);
    // Counted before the project points at the run, so every scan that starts is counted
    // (the usage caps read these events); a scan that cannot be counted does not start.
    await q.insertUsageEvent(db, userId, project.id, "crawl_started");
    // Last, so a failure anywhere above leaves the project on its previous run and status.
    await q.updateProject(db, project.id, { latest_crawl_run_id: run.id, status: "crawling" });
  } catch (e) {
    // Nothing should step a run that was not set up; mark it failed and report the error.
    await q
      .updateRun(db, run.id, { status: "failed", phase: "failed", error: "The scan could not be started.", finished_at: now })
      .catch(() => undefined);
    throw e;
  }
  return run;
}

async function copyPages(
  db: q.Db,
  run: CrawlRunRow,
  project: ProjectRow,
  userId: string,
  source: { runId: string; pages: q.ReusablePageRow[] },
  homeUrl: string,
  cursor: StepCursor,
  now: string,
): Promise<CrawlRunRow> {
  const sourceRun = await q.getRun(db, source.runId);
  const rows = await q.insertPages(
    db,
    source.pages.map((page) => reusedPageRow(page, { runId: run.id, projectId: project.id, userId }, now)),
  );
  const extractQueue = [...rows].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).map((r) => r.id);
  const textBytes = source.pages.reduce((n, p) => n + utf8Bytes(p.text ?? ""), 0);
  const n = rows.length;
  return q.updateRun(db, run.id, {
    phase: "extract",
    cursor: {
      ...cursor,
      homeUrl: sourceRun?.cursor?.homeUrl ?? homeUrl,
      usedSitemap: sourceRun?.cursor?.usedSitemap ?? true,
      queue: [],
      seen: source.pages.map((p) => p.url),
      nextRank: n,
      extractQueue,
    },
    pages_planned: n,
    pages_fetched: n,
    text_bytes: textBytes,
    platform: sourceRun?.platform ?? "unknown",
    platform_evidence: sourceRun?.platform_evidence ?? [],
    robots: sourceRun?.robots ?? null,
    sitemaps: sourceRun?.sitemaps ?? [],
    log: appendLog([], "info", `Reusing ${n} ${n === 1 ? "page" : "pages"} from the last scan`, now),
  });
}
