import "server-only";

/*
  The reads and writes the run state machine and the route handlers repeat.
  Every function takes the service client (RLS on crawl_runs, crawl_pages, and
  fact_sheets is select-only for owners), throws a DbError with a short
  message on failure, and returns typed rows.
*/
import type { PostgrestError } from "@supabase/supabase-js";
import type {
  CrawlPageRow,
  CrawlRunRow,
  Database,
  FactSheetRow,
  ProjectRow,
  UsageEventRow,
} from "@/lib/db/types";
import type { ServiceClient } from "@/lib/supabase/service";
import { lockFilter } from "./logic";

export type Db = ServiceClient;

type Tables = Database["public"]["Tables"];
export type ProjectInsert = Tables["projects"]["Insert"];
export type ProjectUpdate = Tables["projects"]["Update"];
export type CrawlRunInsert = Tables["crawl_runs"]["Insert"];
export type CrawlRunUpdate = Tables["crawl_runs"]["Update"];
export type CrawlPageInsert = Tables["crawl_pages"]["Insert"];
export type CrawlPageUpdate = Tables["crawl_pages"]["Update"];
export type FactSheetInsert = Tables["fact_sheets"]["Insert"];
export type FactSheetUpdate = Tables["fact_sheets"]["Update"];

export class DbError extends Error {
  readonly code: string | null;

  constructor(what: string, cause: PostgrestError) {
    super(`${what}: ${cause.message}`);
    this.name = "DbError";
    this.code = cause.code ?? null;
  }
}

type PostgrestResult = { data: unknown; error: PostgrestError | null };

/** The data of a successful PostgREST response; the failure branch contributes nothing. */
type DataOf<R extends PostgrestResult> = R extends { error: null; data: infer D } ? D : never;

function check(what: string, res: { error: PostgrestError | null }): void {
  if (res.error) throw new DbError(what, res.error);
}

function must<R extends PostgrestResult>(what: string, res: R): NonNullable<DataOf<R>> {
  if (res.error) throw new DbError(what, res.error);
  if (res.data === null || res.data === undefined) throw new Error(`${what}: no row returned`);
  return res.data as NonNullable<DataOf<R>>;
}

function maybe<R extends PostgrestResult>(what: string, res: R): NonNullable<DataOf<R>> | null {
  if (res.error) throw new DbError(what, res.error);
  return (res.data ?? null) as NonNullable<DataOf<R>> | null;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function insertProject(db: Db, row: ProjectInsert): Promise<ProjectRow> {
  return must("insert project", await db.from("projects").insert(row).select().single());
}

export async function getProject(db: Db, projectId: string): Promise<ProjectRow> {
  return must("read project", await db.from("projects").select().eq("id", projectId).single());
}

export async function getProjectForUser(db: Db, projectId: string, userId: string): Promise<ProjectRow | null> {
  return maybe(
    "read project",
    await db.from("projects").select().eq("id", projectId).eq("user_id", userId).maybeSingle(),
  );
}

export async function updateProject(db: Db, projectId: string, patch: ProjectUpdate): Promise<void> {
  check("update project", await db.from("projects").update(patch).eq("id", projectId));
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function insertRun(db: Db, row: CrawlRunInsert): Promise<CrawlRunRow> {
  return must("insert run", await db.from("crawl_runs").insert(row).select().single());
}

export async function getRun(db: Db, runId: string): Promise<CrawlRunRow | null> {
  return maybe("read run", await db.from("crawl_runs").select().eq("id", runId).maybeSingle());
}

export async function getRunForUser(db: Db, runId: string, userId: string): Promise<CrawlRunRow | null> {
  return maybe(
    "read run",
    await db.from("crawl_runs").select().eq("id", runId).eq("user_id", userId).maybeSingle(),
  );
}

export async function updateRun(db: Db, runId: string, patch: CrawlRunUpdate): Promise<CrawlRunRow> {
  return must("update run", await db.from("crawl_runs").update(patch).eq("id", runId).select().single());
}

/**
 * Writes the run only while the given lock token still holds it. Null when the
 * lease was lost (another caller took the lock): the caller must stop.
 */
export async function updateRunLocked(
  db: Db,
  runId: string,
  token: string,
  patch: CrawlRunUpdate,
): Promise<CrawlRunRow | null> {
  return maybe(
    "update run",
    await db.from("crawl_runs").update(patch).eq("id", runId).eq("lock_token", token).select().maybeSingle(),
  );
}

/**
 * Takes the run lock when it is free or its lease has expired. Returns the
 * locked row, or null when another caller holds it.
 */
export async function tryLockRun(
  db: Db,
  runId: string,
  token: string,
  cutoffIso: string,
  nowIso: string,
): Promise<CrawlRunRow | null> {
  return maybe(
    "lock run",
    await db
      .from("crawl_runs")
      .update({ locked_at: nowIso, lock_token: token })
      .eq("id", runId)
      .or(lockFilter(cutoffIso))
      .select()
      .maybeSingle(),
  );
}

/** Releases the lock this token holds, with any closing fields (finished_at). */
export async function releaseRun(db: Db, runId: string, token: string, extra: CrawlRunUpdate = {}): Promise<void> {
  check(
    "release run",
    await db
      .from("crawl_runs")
      .update({ ...extra, locked_at: null, lock_token: null })
      .eq("id", runId)
      .eq("lock_token", token),
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export type PageRef = Pick<CrawlPageRow, "id" | "url" | "normalized_url" | "rank">;

export async function insertPages(db: Db, rows: CrawlPageInsert[]): Promise<PageRef[]> {
  if (!rows.length) return [];
  return must("insert pages", await db.from("crawl_pages").insert(rows).select("id, url, normalized_url, rank"));
}

/**
 * Inserts page rows, skipping any (run_id, normalized_url) that already exists.
 * Returns only the rows it inserted, so a retried step cannot trip the unique
 * constraint on pages an earlier try wrote.
 */
export async function insertNewPages(db: Db, rows: CrawlPageInsert[]): Promise<PageRef[]> {
  if (!rows.length) return [];
  return must(
    "insert pages",
    await db
      .from("crawl_pages")
      .upsert(rows, { onConflict: "run_id,normalized_url", ignoreDuplicates: true })
      .select("id, url, normalized_url, rank"),
  );
}

export async function deletePagesForRun(db: Db, runId: string): Promise<void> {
  check("delete pages", await db.from("crawl_pages").delete().eq("run_id", runId));
}

export type PageForFetch = PageRef & Pick<CrawlPageRow, "status" | "reason" | "text_chars">;

/** Every page row of the run with its status, so a retried fetch step rebuilds its work from the rows. */
export async function listPagesForFetch(db: Db, runId: string): Promise<PageForFetch[]> {
  return must(
    "list pages",
    await db
      .from("crawl_pages")
      .select("id, url, normalized_url, rank, status, reason, text_chars")
      .eq("run_id", runId)
      .order("rank", { ascending: true }),
  );
}

export async function updatePage(db: Db, pageId: string, patch: CrawlPageUpdate): Promise<void> {
  check("update page", await db.from("crawl_pages").update(patch).eq("id", pageId));
}

export type PageForOrder = Pick<CrawlPageRow, "id" | "rank" | "status">;

export async function listPagesForOrder(db: Db, runId: string): Promise<PageForOrder[]> {
  return must(
    "list pages",
    await db.from("crawl_pages").select("id, rank, status").eq("run_id", runId).order("rank", { ascending: true }),
  );
}

export type PageForExtract = Pick<
  CrawlPageRow,
  | "id"
  | "url"
  | "rank"
  | "status"
  | "title"
  | "meta_description"
  | "canonical"
  | "lang"
  | "text"
  | "jsonld"
  | "links"
  | "images"
>;

export async function loadPagesForExtract(db: Db, ids: string[]): Promise<PageForExtract[]> {
  if (!ids.length) return [];
  return must(
    "load pages",
    await db
      .from("crawl_pages")
      .select("id, url, rank, status, title, meta_description, canonical, lang, text, jsonld, links, images")
      .in("id", ids),
  );
}

/** What the run's model calls cost, from llm_calls: failed and refused calls are billed too. */
export async function runLlmCosts(db: Db, runId: string): Promise<{ cost_usd: number }[]> {
  return must("read run cost", await db.from("llm_calls").select("cost_usd").eq("run_id", runId));
}

export type PageForMerge = Pick<
  CrawlPageRow,
  "id" | "url" | "status" | "findings" | "findings_dropped" | "jsonld" | "text_chars" | "extract_tokens_out"
>;

export async function loadPagesForMerge(db: Db, runId: string): Promise<PageForMerge[]> {
  return must(
    "load pages",
    await db
      .from("crawl_pages")
      .select("id, url, status, findings, findings_dropped, jsonld, text_chars, extract_tokens_out")
      .eq("run_id", runId)
      .order("rank", { ascending: true }),
  );
}

/** The most recent run of the project that still holds fetched page text. */
export async function latestReusableRunId(db: Db, projectId: string): Promise<string | null> {
  const row = maybe(
    "find reusable run",
    await db
      .from("crawl_pages")
      .select("run_id")
      .eq("project_id", projectId)
      .in("status", ["fetched", "extracted"])
      .not("text", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row?.run_id ?? null;
}

export type ReusablePageRow = Pick<
  CrawlPageRow,
  | "url"
  | "normalized_url"
  | "rank"
  | "reason"
  | "http_status"
  | "fetched_at"
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

export async function listReusablePages(db: Db, runId: string): Promise<ReusablePageRow[]> {
  return must(
    "list reusable pages",
    await db
      .from("crawl_pages")
      .select(
        "url, normalized_url, rank, reason, http_status, fetched_at, title, meta_description, canonical, lang, text, text_chars, headings, html_path, html_bytes, jsonld, links, images",
      )
      .eq("run_id", runId)
      .in("status", ["fetched", "extracted"])
      .not("text", "is", null)
      .order("rank", { ascending: true }),
  );
}

// ---------------------------------------------------------------------------
// Fact sheets
// ---------------------------------------------------------------------------

export async function maxFactSheetVersion(db: Db, projectId: string): Promise<number> {
  const row = maybe(
    "read fact sheet version",
    await db
      .from("fact_sheets")
      .select("version")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row?.version ?? 0;
}

/** The fact sheet a run already wrote, if any (fact_sheets.crawl_run_id is unique). */
export async function factSheetIdForRun(db: Db, runId: string): Promise<string | null> {
  const row = maybe(
    "read fact sheet",
    await db.from("fact_sheets").select("id").eq("crawl_run_id", runId).limit(1).maybeSingle(),
  );
  return row?.id ?? null;
}

export async function insertFactSheet(db: Db, row: FactSheetInsert): Promise<string> {
  const inserted = must("insert fact sheet", await db.from("fact_sheets").insert(row).select("id").single());
  return inserted.id;
}

export async function getFactSheetForUser(db: Db, factSheetId: string, userId: string): Promise<FactSheetRow | null> {
  return maybe(
    "read fact sheet",
    await db.from("fact_sheets").select().eq("id", factSheetId).eq("user_id", userId).maybeSingle(),
  );
}

export async function updateFactSheet(db: Db, factSheetId: string, patch: FactSheetUpdate): Promise<void> {
  check("update fact sheet", await db.from("fact_sheets").update(patch).eq("id", factSheetId));
}

/**
 * Writes the fact sheet only if nobody changed it since it was read (its
 * updated_at, which a trigger moves on every update, still matches). False
 * when another edit landed first: read again and reapply.
 */
export async function updateFactSheetIfUnchanged(
  db: Db,
  factSheetId: string,
  readUpdatedAt: string,
  patch: FactSheetUpdate,
): Promise<boolean> {
  const row = maybe(
    "update fact sheet",
    await db
      .from("fact_sheets")
      .update(patch)
      .eq("id", factSheetId)
      .eq("updated_at", readUpdatedAt)
      .select("id")
      .maybeSingle(),
  );
  return row !== null;
}

// ---------------------------------------------------------------------------
// Usage events
// ---------------------------------------------------------------------------

export async function insertUsageEvent(
  db: Db,
  userId: string,
  projectId: string | null,
  kind: UsageEventRow["kind"],
): Promise<void> {
  check("insert usage event", await db.from("usage_events").insert({ user_id: userId, project_id: projectId, kind }));
}
