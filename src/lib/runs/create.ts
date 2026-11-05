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
  let run = await q.insertRun(db, {
    project_id: project.id,
    user_id: userId,
    status: "queued",
    phase: source ? "extract" : "discover",
    cursor,
    log: [],
  });

  if (source) {
    const sourceRun = await q.getRun(db, source.runId);
    const rows = await q.insertPages(
      db,
      source.pages.map((page) => reusedPageRow(page, { runId: run.id, projectId: project.id, userId }, now)),
    );
    const extractQueue = [...rows].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).map((r) => r.id);
    const textBytes = source.pages.reduce((n, p) => n + utf8Bytes(p.text ?? ""), 0);
    const n = rows.length;
    run = await q.updateRun(db, run.id, {
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

  await q.updateProject(db, project.id, { latest_crawl_run_id: run.id, status: "crawling" });
  await q.insertUsageEvent(db, userId, project.id, "crawl_started");
  return run;
}
