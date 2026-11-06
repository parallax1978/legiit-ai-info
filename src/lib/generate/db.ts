import "server-only";

/*
  The reads and writes the generation job and its route handlers repeat, in
  the style of src/lib/runs/db.ts: every function takes the service client
  (or the session client, for reads from a server component), throws a
  DbError with a short message on failure, and returns typed rows. The
  project, run, and usage event queries are shared with the runs module.
*/
import type { PostgrestError } from "@supabase/supabase-js";
import type { Database, FactSheetRow, GenerationRow, ShareLinkRow } from "@/lib/db/types";
import { DbError, type Db } from "@/lib/runs/db";
import { lockFilter } from "@/lib/runs/logic";

export { DbError, type Db };
export { getProject, getProjectForUser, getRun, insertUsageEvent, updateProject } from "@/lib/runs/db";

type Tables = Database["public"]["Tables"];
export type GenerationInsert = Tables["generations"]["Insert"];
export type GenerationUpdate = Tables["generations"]["Update"];
export type ShareLinkInsert = Tables["share_links"]["Insert"];

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
// Generations
// ---------------------------------------------------------------------------

export async function insertGeneration(db: Db, row: GenerationInsert): Promise<GenerationRow> {
  return must("insert generation", await db.from("generations").insert(row).select().single());
}

export async function getGeneration(db: Db, generationId: string): Promise<GenerationRow | null> {
  return maybe("read generation", await db.from("generations").select().eq("id", generationId).maybeSingle());
}

export async function getGenerationForUser(db: Db, generationId: string, userId: string): Promise<GenerationRow | null> {
  return maybe(
    "read generation",
    await db.from("generations").select().eq("id", generationId).eq("user_id", userId).maybeSingle(),
  );
}

/** The newest generation of a project, whatever its status. */
export async function latestGenerationForProject(db: Db, projectId: string): Promise<GenerationRow | null> {
  return maybe(
    "read generation",
    await db
      .from("generations")
      .select()
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
}

export async function maxGenerationVersion(db: Db, projectId: string): Promise<number> {
  const row = maybe(
    "read generation version",
    await db
      .from("generations")
      .select("version")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row?.version ?? 0;
}

export async function updateGeneration(db: Db, generationId: string, patch: GenerationUpdate): Promise<GenerationRow> {
  return must(
    "update generation",
    await db.from("generations").update(patch).eq("id", generationId).select().single(),
  );
}

/**
 * Writes the generation only while the given lock token still holds it. Null
 * when the lease was lost (another caller took the lock): the caller must stop.
 */
export async function updateGenerationLocked(
  db: Db,
  generationId: string,
  token: string,
  patch: GenerationUpdate,
): Promise<GenerationRow | null> {
  return maybe(
    "update generation",
    await db
      .from("generations")
      .update(patch)
      .eq("id", generationId)
      .eq("lock_token", token)
      .select()
      .maybeSingle(),
  );
}

/**
 * Takes the generation lock when it is free or its lease has expired. Returns
 * the locked row, or null when another caller holds it.
 */
export async function tryLockGeneration(
  db: Db,
  generationId: string,
  token: string,
  cutoffIso: string,
  nowIso: string,
): Promise<GenerationRow | null> {
  return maybe(
    "lock generation",
    await db
      .from("generations")
      .update({ locked_at: nowIso, lock_token: token })
      .eq("id", generationId)
      .or(lockFilter(cutoffIso))
      .select()
      .maybeSingle(),
  );
}

/** Releases the lock this token holds, with any closing fields. */
export async function releaseGeneration(
  db: Db,
  generationId: string,
  token: string,
  extra: GenerationUpdate = {},
): Promise<void> {
  check(
    "release generation",
    await db
      .from("generations")
      .update({ ...extra, locked_at: null, lock_token: null })
      .eq("id", generationId)
      .eq("lock_token", token),
  );
}

/** What the generation's model calls cost, from llm_calls: failed and refused calls are billed too. */
export async function generationLlmCosts(db: Db, generationId: string): Promise<{ cost_usd: number }[]> {
  return must(
    "read generation cost",
    await db.from("llm_calls").select("cost_usd").eq("generation_id", generationId),
  );
}

// ---------------------------------------------------------------------------
// Fact sheets, as the generation reads them
// ---------------------------------------------------------------------------

export async function getFactSheet(db: Db, factSheetId: string): Promise<FactSheetRow | null> {
  return maybe("read fact sheet", await db.from("fact_sheets").select().eq("id", factSheetId).maybeSingle());
}

/** The highest version of the project's fact sheet. */
export async function latestFactSheetForProject(db: Db, projectId: string): Promise<FactSheetRow | null> {
  return maybe(
    "read fact sheet",
    await db
      .from("fact_sheets")
      .select()
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export async function getShareLinkByToken(db: Db, token: string): Promise<ShareLinkRow | null> {
  return maybe("read share link", await db.from("share_links").select().eq("token", token).maybeSingle());
}

/** The newest share link of a generation that has not expired, or null. */
export async function activeShareLinkForGeneration(
  db: Db,
  generationId: string,
  nowIso: string = new Date().toISOString(),
): Promise<ShareLinkRow | null> {
  return maybe(
    "read share link",
    await db
      .from("share_links")
      .select()
      .eq("generation_id", generationId)
      .or(`expires_at.is.null,expires_at.gt."${nowIso}"`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
}

export async function insertShareLink(db: Db, row: ShareLinkInsert): Promise<ShareLinkRow> {
  return must("insert share link", await db.from("share_links").insert(row).select().single());
}

export async function deleteShareLinksForGeneration(db: Db, generationId: string): Promise<void> {
  check("delete share links", await db.from("share_links").delete().eq("generation_id", generationId));
}
