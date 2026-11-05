/*
  The whole scan on a real PostgreSQL, through the real route handlers.

    pnpm e2e:local

  Needs the same local PostgreSQL 16 as pnpm db:check (port 54329, trust
  auth; E2E_PG_HOST, E2E_PG_PORT, and E2E_PG_USER override the defaults). The
  run drops and recreates the database lai_e2e and applies every migration.

  What is real: the route handlers for creating a project, stepping a run,
  reading a run, editing a fact sheet, and starting a re-run; the run state
  machine; discovery, fetching, cleaning, ranking, and robots.txt; extraction
  through callStructured with llm_calls logging; quote verification; the
  merge; and every query, which runs on PostgreSQL through supabase-js.

  What stands in: PostgREST and Storage (scripts/e2e/postgrest-lite.ts), the
  Anthropic API and the business site (scripts/e2e/fakes.ts), and the session
  cookie (requireApiUser returns a fixed user). The crawler's URL checks run on
  the real addresses; only the socket goes to the local site, and the
  connect-time address check has its own test in src/lib/crawler.
*/
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SITE_ORIGIN, startFakeModel, startFakeSite, type FakeModel, type FakeServer } from "./fakes";
import { startPostgrestLite, type PostgrestLite } from "./postgrest-lite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  siteUrl: "",
  user: null as { id: string; email: string } | null,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/app/api/_lib/http", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/app/api/_lib/http")>();
  return {
    ...mod,
    requireApiUser: async () => (h.user ? { user: h.user } : { response: mod.jsonError(401, "Sign in to continue.") }),
  };
});

vi.mock("@/lib/crawler/fetch", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/crawler/fetch")>();
  const siteFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (u.hostname !== "acme-roofing.example") return Promise.reject(new TypeError(`no route to ${u.hostname}`));
    return fetch(`${h.siteUrl}${u.pathname}${u.search}`, init);
  }) as typeof fetch;
  return {
    ...mod,
    fetchText: (url: string, opts: Parameters<typeof mod.fetchText>[1]) => mod.fetchText(url, { ...opts, fetchImpl: siteFetch }),
    fetchPage: (url: string, opts: Parameters<typeof mod.fetchPage>[1]) => mod.fetchPage(url, { ...opts, fetchImpl: siteFetch }),
  };
});

import { PATCH as editFactSheet } from "@/app/api/fact-sheets/[id]/route";
import { POST as startRun } from "@/app/api/projects/[id]/runs/route";
import { POST as createProject } from "@/app/api/projects/route";
import { GET as readRun } from "@/app/api/runs/[id]/route";
import { POST as stepRoute } from "@/app/api/runs/[id]/step/route";
import type { FactSheetData, ListItem } from "@/lib/facts/types";
import type { RunView } from "@/lib/projects/view";

const PG = {
  host: process.env.E2E_PG_HOST ?? "/tmp",
  port: Number(process.env.E2E_PG_PORT ?? 54329),
  user: process.env.E2E_PG_USER ?? "postgres",
};
const DB = "lai_e2e";

let pool: Pool;
let rest: PostgrestLite;
let site: FakeServer;
let model: FakeModel;

const as = (user: string) => {
  h.user = { id: user, email: user === OWNER ? "owner@acme-roofing.example" : "other@example.com" };
};

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function post(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function patch(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Steps the run through the step route, the way the project page does, until it finishes. */
async function stepUntilFinished(runId: string): Promise<{ run: RunView; steps: number }> {
  for (let steps = 1; steps <= 40; steps++) {
    const res = await stepRoute(post(`/api/runs/${runId}/step`), params(runId));
    const body = (await res.json()) as { run?: RunView; error?: string };
    if (res.status === 409) continue;
    if (res.status !== 200 || !body.run) throw new Error(`step answered ${res.status}: ${JSON.stringify(body)}`);
    if (["done", "failed", "cancelled"].includes(body.run.status)) return { run: body.run, steps };
  }
  throw new Error("the run did not finish in 40 steps");
}

async function one<T>(sql: string, values: unknown[] = []): Promise<T> {
  const { rows } = await pool.query(sql, values);
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}: ${sql}`);
  return rows[0] as T;
}

const digits = (v: unknown) => String(v).replace(/\D/g, "").slice(-10);

beforeAll(async () => {
  const admin = new Client({ ...PG, database: "postgres" });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.end();

  pool = new Pool({ ...PG, database: DB, max: 16 });
  const migrations = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join("supabase/migrations", f));
  for (const file of ["supabase/test/harness.sql", ...migrations]) await pool.query(readFileSync(file, "utf8"));
  await pool.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [
    OWNER,
    "owner@acme-roofing.example",
    OTHER,
    "other@example.com",
  ]);

  [rest, site, model] = await Promise.all([startPostgrestLite(pool), startFakeSite(), startFakeModel()]);
  h.siteUrl = site.url;
  process.env.NEXT_PUBLIC_SUPABASE_URL = rest.url;
  process.env.SUPABASE_SECRET_KEY = "sb_secret_e2e";
  process.env.ANTHROPIC_API_KEY = "sk-ant-e2e";
  process.env.ANTHROPIC_BASE_URL = model.url;
  as(OWNER);
});

afterAll(async () => {
  await Promise.all([rest?.close(), site?.close(), model?.close()]);
  await pool?.end();
});

describe("a scan from sign-in to fact sheet", () => {
  let projectId = "";
  let runId = "";
  let sheetId = "";

  it("creates the project, crawls the site, and writes a fact sheet with evidence", async () => {
    const res = await createProject(post("/api/projects", { siteUrl: "acme-roofing.example" }));
    expect(res.status).toBe(201);
    ({ projectId, runId } = (await res.json()) as { projectId: string; runId: string });

    const { run, steps } = await stepUntilFinished(runId);
    expect(run).toMatchObject({ status: "done", phase: "done", done: true, progress: 1, error: null });
    expect(steps).toBeLessThan(15);

    const project = await one<Record<string, unknown>>("select * from projects where id = $1", [projectId]);
    expect(project).toMatchObject({
      status: "review",
      site_url: `${SITE_ORIGIN}/`,
      site_host: "acme-roofing.example",
      latest_crawl_run_id: runId,
    });

    // robots.txt is respected, and non-HTML links are never requested.
    expect(site.requests).toContain("GET /robots.txt");
    expect(site.requests.some((r) => r.includes("/private/"))).toBe(false);
    expect(site.requests.some((r) => r.includes("brochure.pdf"))).toBe(false);
    // Pages are fetched the way the sitemap spells them, so none costs a redirect hop.
    expect(site.requests.filter((r) => /^GET \/(about-us|services|pricing|contact)$/.test(r))).toEqual([]);

    const pages = (
      await pool.query<{ url: string; status: string; error: string | null; html_path: string | null; text_chars: number }>(
        "select url, status, error, html_path, text_chars from crawl_pages where run_id = $1 order by rank",
        [runId],
      )
    ).rows;
    const byPath = new Map(pages.map((p) => [new URL(p.url).pathname, p]));
    expect(byPath.get("/")?.status).toBe("extracted");
    // The menu's old "/about" redirects to "/about-us/", which the sitemap lists: it is read once.
    expect(byPath.get("/about")).toMatchObject({ status: "skipped", error: `same page as ${SITE_ORIGIN}/about-us/` });
    for (const path of ["/about-us/", "/services/", "/contact/"]) {
      expect(byPath.get(path) ?? byPath.get(path.replace(/\/$/, "")), path).toMatchObject({ status: "extracted" });
    }
    // The model failed on the pricing page twice; the page keeps its deterministic findings and the scan goes on.
    const pricing = byPath.get("/pricing/") ?? byPath.get("/pricing");
    expect(pricing?.status).toBe("failed");
    expect(pricing?.error).toMatch(/^extraction: /);
    // Every fetched page's HTML went to the private bucket.
    for (const p of pages.filter((x) => x.status !== "skipped")) {
      expect(p.html_path, p.url).toMatch(new RegExp(`^${projectId}/${runId}/.+\\.html$`));
      expect(rest.objects.has(`crawl-html/${p.html_path}`)).toBe(true);
      expect(p.text_chars).toBeGreaterThan(0);
    }

    const sheet = await one<{ id: string; version: number; source: string; data: FactSheetData; stats: Record<string, number> }>(
      "select id, version, source, data, stats from fact_sheets where crawl_run_id = $1",
      [runId],
    );
    sheetId = sheet.id;
    expect(sheet).toMatchObject({ version: 1, source: "crawl" });
    expect(await one("select latest_fact_sheet_id as id from projects where id = $1", [projectId])).toEqual({ id: sheet.id });

    const f = sheet.data.fields;
    // Found, with a verbatim quote and its page.
    expect(f.company_name).toMatchObject({ status: "found", value: "Acme Roofing" });
    expect(f.company_name.evidence.some((e) => e.source === "page" && e.url.startsWith(SITE_ORIGIN) && e.quote.includes("Acme Roofing"))).toBe(true);
    const services = (f.services.value as ListItem[]).map((i) => i.name).sort();
    expect(services).toEqual(["Gutter installation", "Roof repair", "Roof replacement"]);
    // A conflict shows both values with their evidence.
    expect(f.phone.status).toBe("conflict");
    expect(new Set((f.phone.candidates ?? []).map((c) => digits(c.value)))).toEqual(new Set(["9375550142", "9375550199"]));
    for (const c of f.phone.candidates ?? []) expect(c.evidence.length).toBeGreaterThan(0);
    // The model's unsupported claim was dropped; nothing on the site states a mission.
    expect(f.mission.status).toBe("missing");
    expect(f.contract_terms.status).toBe("missing");
    expect(sheet.stats.findingsDropped).toBeGreaterThan(0);

    // Every model call is logged with model, tokens, and cost; the run's cost is their sum.
    const calls = (
      await pool.query<{ ok: boolean; model: string; purpose: string; input_tokens: number; output_tokens: number; cost_usd: string; error: string | null; project_id: string; user_id: string }>(
        "select ok, model, purpose, input_tokens, output_tokens, cost_usd, error, project_id, user_id from llm_calls where run_id = $1",
        [runId],
      )
    ).rows;
    const ok = calls.filter((c) => c.ok);
    expect(ok).toHaveLength(4);
    expect(calls.filter((c) => !c.ok)).toHaveLength(2);
    for (const c of ok) {
      expect(c).toMatchObject({ model: "claude-haiku-5-5", purpose: "extract_page", project_id: projectId, user_id: OWNER });
      expect(c.input_tokens).toBeGreaterThan(0);
      expect(Number(c.cost_usd)).toBeGreaterThan(0);
    }
    for (const c of calls.filter((x) => !x.ok)) expect(c.error).toMatch(/500/);
    const cost = await one<{ run: string; calls: string }>(
      "select r.cost_usd as run, (select sum(cost_usd) from llm_calls where run_id = r.id) as calls from crawl_runs r where r.id = $1",
      [runId],
    );
    expect(Math.abs(Number(cost.run) - Number(cost.calls))).toBeLessThan(1e-9);
    expect(model.pages.filter((u) => u.includes("/pricing"))).toHaveLength(2);

    const events = (await pool.query<{ kind: string }>("select kind from usage_events where project_id = $1 order by created_at", [projectId])).rows;
    expect(events.map((e) => e.kind)).toEqual(["project_created", "crawl_started"]);
  });

  it("keeps every edit when several land on the same fact sheet at once", async () => {
    const before = await one<{ data: FactSheetData }>("select data from fact_sheets where id = $1", [sheetId]);
    const pick = (before.data.fields.phone.candidates ?? []).findIndex((c) => digits(c.value) === "9375550142");
    expect(pick).toBeGreaterThanOrEqual(0);

    const edits = [
      { fieldId: "contract_terms", value: "No contracts. Every job gets a written quote and is paid on completion." },
      { fieldId: "mission", value: "Keep Dayton homes dry." },
      { fieldId: "phone", pickCandidate: pick },
    ];
    const responses = await Promise.all(edits.map((e) => editFactSheet(patch(`/api/fact-sheets/${sheetId}`, e), params(sheetId))));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);

    const after = await one<{ data: FactSheetData }>("select data from fact_sheets where id = $1", [sheetId]);
    const f = after.data.fields;
    expect(f.contract_terms).toMatchObject({ status: "user_provided", value: edits[0].value });
    expect(f.mission).toMatchObject({ status: "user_provided", value: "Keep Dayton homes dry." });
    expect(f.phone.status).toBe("user_provided");
    expect(digits(f.phone.value)).toBe("9375550142");
  });

  it("answers another user's run and fact sheet as not found", async () => {
    as(OTHER);
    try {
      expect((await readRun(new Request(`http://localhost/api/runs/${runId}`), params(runId))).status).toBe(404);
      expect((await stepRoute(post(`/api/runs/${runId}/step`), params(runId))).status).toBe(404);
      const edit = await editFactSheet(patch(`/api/fact-sheets/${sheetId}`, { fieldId: "mission", value: "Mine now." }), params(sheetId));
      expect(edit.status).toBe(404);
      expect((await startRun(post(`/api/projects/${projectId}/runs`, {}), params(projectId))).status).toBe(404);
    } finally {
      as(OWNER);
    }
    const sheet = await one<{ data: FactSheetData }>("select data from fact_sheets where id = $1", [sheetId]);
    expect(sheet.data.fields.mission.value).toBe("Keep Dayton homes dry.");
  });

  it("re-runs from the stored pages without fetching the site again", async () => {
    const siteRequests = site.requests.length;
    const res = await startRun(post(`/api/projects/${projectId}/runs`, { reusePages: true }), params(projectId));
    expect(res.status).toBe(201);
    const { runId: rerunId } = (await res.json()) as { runId: string };

    const { run } = await stepUntilFinished(rerunId);
    expect(run.status).toBe("done");
    expect(site.requests.length).toBe(siteRequests);

    const sheet = await one<{ id: string; version: number }>("select id, version from fact_sheets where crawl_run_id = $1", [rerunId]);
    expect(sheet.version).toBe(2);
    expect(await one("select latest_crawl_run_id as run, latest_fact_sheet_id as sheet, status from projects where id = $1", [projectId])).toEqual({
      run: rerunId,
      sheet: sheet.id,
      status: "review",
    });
  });

  it("lets one caller step a run at a time", async () => {
    const res = await startRun(post(`/api/projects/${projectId}/runs`, {}), params(projectId));
    expect(res.status).toBe(201);
    const { runId: raceId } = (await res.json()) as { runId: string };

    const statuses = (
      await Promise.all([stepRoute(post(`/api/runs/${raceId}/step`), params(raceId)), stepRoute(post(`/api/runs/${raceId}/step`), params(raceId))])
    ).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 409]);

    const { run } = await stepUntilFinished(raceId);
    expect(run.status).toBe("done");
    // One fact sheet per run, however the steps raced.
    expect(await one("select count(*)::int as n from fact_sheets where crawl_run_id = $1", [raceId])).toEqual({ n: 1 });
  });
});
