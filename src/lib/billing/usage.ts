import "server-only";

/*
  Counts from usage_events for the plan caps and the account page. Every
  function takes the service client, or the session client when a server
  component reads the owner's own rows. Rows are counted after the query
  rather than with a count header: the counts are bounded by the caps, and
  the local PostgREST stand-in answers rows only.
*/
import type { PostgrestError } from "@supabase/supabase-js";
import type { UsageEventRow } from "@/lib/db/types";
import { DbError, type Db } from "@/lib/runs/db";

export type UsageKind = UsageEventRow["kind"];

/** Midnight UTC on the first day of the month that holds `now`, as ISO. The monthly cap counts from here. */
export function monthStartUtc(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

type RowsResult = { data: unknown; error: PostgrestError | null };

async function countRows(what: string, query: PromiseLike<RowsResult>): Promise<number> {
  const res = await query;
  if (res.error) throw new DbError(what, res.error);
  return Array.isArray(res.data) ? res.data.length : 0;
}

/** Projects the user created in the current UTC month (usage events `project_created`). */
export async function monthlyProjects(db: Db, userId: string, now: Date = new Date()): Promise<number> {
  return countRows(
    "count projects this month",
    db
      .from("usage_events")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", "project_created")
      .gte("created_at", monthStartUtc(now)),
  );
}

/** Scans started for the project over its whole life (usage events `crawl_started`). */
export async function crawlsForProject(db: Db, projectId: string): Promise<number> {
  return countRows(
    "count scans",
    db.from("usage_events").select("id").eq("project_id", projectId).eq("kind", "crawl_started"),
  );
}

/** Page generations started for the project (usage events `generation_started`). */
export async function generationsForProject(db: Db, projectId: string): Promise<number> {
  return countRows(
    "count generations",
    db.from("usage_events").select("id").eq("project_id", projectId).eq("kind", "generation_started"),
  );
}

export interface MonthlyUsage {
  projects: number;
  crawls: number;
  generations: number;
}

/** Everything the user started in the current UTC month, across their projects, for the account page. */
export async function monthlyUsage(db: Db, userId: string, now: Date = new Date()): Promise<MonthlyUsage> {
  const res = await db.from("usage_events").select("kind").eq("user_id", userId).gte("created_at", monthStartUtc(now));
  if (res.error) throw new DbError("read usage this month", res.error);
  const usage: MonthlyUsage = { projects: 0, crawls: 0, generations: 0 };
  for (const row of res.data ?? []) {
    if (row.kind === "project_created") usage.projects += 1;
    else if (row.kind === "crawl_started") usage.crawls += 1;
    else if (row.kind === "generation_started") usage.generations += 1;
  }
  return usage;
}
