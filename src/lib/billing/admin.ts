import "server-only";

/*
  Reads for the admin pages, with the service client, and the pure
  aggregation the cost dashboard shows. The dashboard reads llm_calls for the
  last 90 days in pages of 1,000 rows (PostgREST's ceiling per request) and
  sums in memory: the volume is small, and the same query shape runs on the
  local stand-in and on Supabase.
*/
import type { PostgrestError } from "@supabase/supabase-js";
import type { CrawlRunRow, GenerationRow, LlmCallRow, ProfileRow, ProjectRow } from "@/lib/db/types";
import { DbError, type Db } from "@/lib/runs/db";

export const WINDOWS = [7, 30, 90] as const;
/** How far back the dashboard reads llm_calls. */
export const DASHBOARD_DAYS = 90;
/** Days in the spend-by-day table. */
export const BY_DAY_DAYS = 30;
const PAGE = 1000;
const MAX_ROWS = 50_000;
const DAY_MS = 86_400_000;

export type CallRow = Pick<LlmCallRow, "id" | "user_id" | "project_id" | "purpose" | "model" | "cost_usd" | "ok" | "error" | "created_at">;
export type ProfileSummary = Pick<ProfileRow, "id" | "email" | "plan" | "created_at">;
export type ProjectSummary = Pick<ProjectRow, "id" | "user_id" | "site_url" | "site_host" | "business_name" | "status" | "created_at">;
export type GenerationSummary = Pick<GenerationRow, "id" | "project_id" | "user_id" | "status" | "created_at">;
export type RunSummary = Pick<CrawlRunRow, "id" | "project_id" | "status" | "created_at">;

export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** numeric columns arrive as numbers from PostgREST; a string from another path still adds up. */
export function usd(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Dollars with cents, or four places under a dollar, where model calls live. */
export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const places = abs > 0 && abs < 1 ? 4 : 2;
  return `$${value.toFixed(places)}`;
}

type PageResult<T> = { data: T[] | null; error: PostgrestError | null };

/** Every row of a query, read in pages, so a long table is not cut at PostgREST's row ceiling. */
export async function fetchAll<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  max = MAX_ROWS,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const res = await page(from, from + PAGE - 1);
    if (res.error) throw new DbError(what, res.error);
    const batch = res.data ?? [];
    for (const row of batch) rows.push(row);
    if (batch.length < PAGE) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function listCalls(db: Db, sinceIso: string): Promise<CallRow[]> {
  return fetchAll<CallRow>("list model calls", (from, to) =>
    db
      .from("llm_calls")
      .select("id, user_id, project_id, purpose, model, cost_usd, ok, error, created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export function listProfiles(db: Db): Promise<ProfileSummary[]> {
  return fetchAll<ProfileSummary>("list users", (from, to) =>
    db
      .from("profiles")
      .select("id, email, plan, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export function listProjects(db: Db): Promise<ProjectSummary[]> {
  return fetchAll<ProjectSummary>("list projects", (from, to) =>
    db
      .from("projects")
      .select("id, user_id, site_url, site_host, business_name, status, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export function listGenerations(db: Db): Promise<GenerationSummary[]> {
  return fetchAll<GenerationSummary>("list generations", (from, to) =>
    db
      .from("generations")
      .select("id, project_id, user_id, status, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export function listRuns(db: Db): Promise<RunSummary[]> {
  return fetchAll<RunSummary>("list runs", (from, to) =>
    db
      .from("crawl_runs")
      .select("id, project_id, status, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
}

// ---------------------------------------------------------------------------
// Aggregation (pure)
// ---------------------------------------------------------------------------

export interface WindowTotals {
  days: number;
  spendUsd: number;
  calls: number;
  failedCalls: number;
  newUsers: number;
  projects: number;
  generations: number;
}

export interface DashboardInput {
  calls: CallRow[];
  profiles: ProfileSummary[];
  projects: ProjectSummary[];
  generations: GenerationSummary[];
}

export function totalsForWindow(input: DashboardInput, days: number, now: Date): WindowTotals {
  const since = now.getTime() - days * DAY_MS;
  const within = (iso: string) => Date.parse(iso) >= since;
  const calls = input.calls.filter((c) => within(c.created_at));
  return {
    days,
    spendUsd: calls.reduce((n, c) => n + usd(c.cost_usd), 0),
    calls: calls.length,
    failedCalls: calls.filter((c) => !c.ok).length,
    newUsers: input.profiles.filter((p) => within(p.created_at)).length,
    projects: input.projects.filter((p) => within(p.created_at)).length,
    generations: input.generations.filter((g) => within(g.created_at)).length,
  };
}

export interface SpendRow {
  key: string;
  calls: number;
  spendUsd: number;
}

/** Spend grouped by a key, largest first; rows whose key is null are left out. */
export function spendBy(calls: CallRow[], keyOf: (c: CallRow) => string | null): SpendRow[] {
  const groups = new Map<string, SpendRow>();
  for (const c of calls) {
    const key = keyOf(c);
    if (key === null) continue;
    const row = groups.get(key) ?? { key, calls: 0, spendUsd: 0 };
    row.calls += 1;
    row.spendUsd += usd(c.cost_usd);
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.spendUsd - a.spendUsd || a.key.localeCompare(b.key));
}

/** The UTC date of a timestamp, as YYYY-MM-DD. */
export function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Spend per UTC day over the last `days` days, newest first; days with no calls are left out. */
export function spendByDay(calls: CallRow[], days: number, now: Date): SpendRow[] {
  const since = now.getTime() - days * DAY_MS;
  const recent = calls.filter((c) => Date.parse(c.created_at) >= since);
  return spendBy(recent, (c) => utcDay(c.created_at)).sort((a, b) => b.key.localeCompare(a.key));
}

export function topProjects(calls: CallRow[], n = 10): SpendRow[] {
  return spendBy(calls, (c) => c.project_id).slice(0, n);
}

/** The most recent failed calls. */
export function failedCalls(calls: CallRow[], n = 10): CallRow[] {
  return calls
    .filter((c) => !c.ok)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, n);
}

function countBy<T>(rows: T[], keyOf: (row: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function projectLabel(p: Pick<ProjectSummary, "business_name" | "site_host" | "site_url">): string {
  return p.business_name || p.site_host || p.site_url;
}

// ---------------------------------------------------------------------------
// Page loaders
// ---------------------------------------------------------------------------

export interface TopProject extends SpendRow {
  label: string;
  ownerEmail: string | null;
}

export interface Dashboard {
  totals: WindowTotals[];
  byDay: SpendRow[];
  byPurpose: SpendRow[];
  byModel: SpendRow[];
  topProjects: TopProject[];
  failedCount: number;
  recentFailed: CallRow[];
}

export async function loadDashboard(db: Db, now: Date = new Date()): Promise<Dashboard> {
  const [calls, profiles, projects, generations] = await Promise.all([
    listCalls(db, daysAgoIso(DASHBOARD_DAYS, now)),
    listProfiles(db),
    listProjects(db),
    listGenerations(db),
  ]);
  const input: DashboardInput = { calls, profiles, projects, generations };
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const emailsById = new Map(profiles.map((p) => [p.id, p.email]));
  return {
    totals: WINDOWS.map((days) => totalsForWindow(input, days, now)),
    byDay: spendByDay(calls, BY_DAY_DAYS, now),
    byPurpose: spendBy(calls, (c) => c.purpose),
    byModel: spendBy(calls, (c) => c.model),
    topProjects: topProjects(calls).map((row) => {
      const project = projectsById.get(row.key);
      return {
        ...row,
        label: project ? projectLabel(project) : "Deleted project",
        ownerEmail: project ? (emailsById.get(project.user_id) ?? null) : null,
      };
    }),
    failedCount: calls.filter((c) => !c.ok).length,
    recentFailed: failedCalls(calls),
  };
}

export interface UserAdminRow {
  id: string;
  email: string;
  plan: ProfileRow["plan"];
  projects: number;
  /** Over the dashboard window. */
  spendUsd: number;
  createdAt: string;
}

export async function loadUsers(db: Db, now: Date = new Date()): Promise<UserAdminRow[]> {
  const [profiles, projects, calls] = await Promise.all([
    listProfiles(db),
    listProjects(db),
    listCalls(db, daysAgoIso(DASHBOARD_DAYS, now)),
  ]);
  const projectCount = countBy(projects, (p) => p.user_id);
  const spend = new Map(spendBy(calls, (c) => c.user_id).map((r) => [r.key, r.spendUsd]));
  return profiles.map((p) => ({
    id: p.id,
    email: p.email,
    plan: p.plan,
    projects: projectCount.get(p.id) ?? 0,
    spendUsd: spend.get(p.id) ?? 0,
    createdAt: p.created_at,
  }));
}

export interface ProjectAdminRow {
  id: string;
  label: string;
  siteUrl: string;
  ownerEmail: string | null;
  status: ProjectRow["status"];
  runs: number;
  generations: number;
  /** Over the dashboard window. */
  spendUsd: number;
  createdAt: string;
}

export async function loadProjects(db: Db, now: Date = new Date()): Promise<ProjectAdminRow[]> {
  const [projects, profiles, runs, generations, calls] = await Promise.all([
    listProjects(db),
    listProfiles(db),
    listRuns(db),
    listGenerations(db),
    listCalls(db, daysAgoIso(DASHBOARD_DAYS, now)),
  ]);
  const emailsById = new Map(profiles.map((p) => [p.id, p.email]));
  const runCount = countBy(runs, (r) => r.project_id);
  const generationCount = countBy(generations, (g) => g.project_id);
  const spend = new Map(spendBy(calls, (c) => c.project_id).map((r) => [r.key, r.spendUsd]));
  return projects.map((p) => ({
    id: p.id,
    label: projectLabel(p),
    siteUrl: p.site_url,
    ownerEmail: emailsById.get(p.user_id) ?? null,
    status: p.status,
    runs: runCount.get(p.id) ?? 0,
    generations: generationCount.get(p.id) ?? 0,
    spendUsd: spend.get(p.id) ?? 0,
    createdAt: p.created_at,
  }));
}
