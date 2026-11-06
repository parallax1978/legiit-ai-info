/*
  The whole scan through the real route handlers, on a real database.

    pnpm e2e:local      PostgreSQL 16 on port 54329 (the db:check server) behind the PostgREST stand-in
    pnpm e2e:supabase   the Supabase project named in .env.local

  What is real in both: the route handlers for creating a project, stepping a
  run, reading a run, editing a fact sheet, and starting a re-run; the run
  state machine; discovery, fetching, cleaning, ranking, and robots.txt;
  extraction through callStructured with llm_calls logging; quote
  verification; the merge; and every query, which runs through supabase-js.

  On Supabase, PostgREST, Storage, Auth, and RLS are the real ones too: the
  test users are auth users made with the admin API, and the last section
  signs in with the publishable key and checks what the browser can see and
  do. What stands in everywhere: the business site and the Anthropic API
  (scripts/e2e/fakes.ts), and the session cookie (requireApiUser returns the
  test user, because the route handlers read cookies through next/headers).
  The crawler's URL checks run on the real addresses; only the socket goes to
  the local site, and the connect-time address check has its own test.
*/
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { anonClient, BACKEND, signedInClient, startBackend, type Backend, type TestUser } from "./backend";
import { SITE_ORIGIN, startFakeModel, startFakeSite, type FakeModel, type FakeServer } from "./fakes";

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

let backend: Backend;
let site: FakeServer;
let model: FakeModel;

/** What the first scan made, for the later tests. */
const made = { projectId: "", runId: "", sheetId: "", htmlPath: "" };

const as = (user: TestUser) => {
  h.user = { id: user.id, email: user.email };
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
  for (let steps = 1; steps <= 60; steps++) {
    const res = await stepRoute(post(`/api/runs/${runId}/step`), params(runId));
    const body = (await res.json()) as { run?: RunView; error?: string };
    if (res.status === 409) continue;
    if (res.status !== 200 || !body.run) throw new Error(`step answered ${res.status}: ${JSON.stringify(body)}`);
    if (["done", "failed", "cancelled"].includes(body.run.status)) return { run: body.run, steps };
  }
  throw new Error("the run did not finish in 60 steps");
}

type Res = { data: unknown; error: { message: string } | null };

/** The data of a successful PostgREST response; the failure branch contributes nothing. */
type Ok<R extends Res> = R extends { error: null; data: infer D } ? D : never;

async function row<R extends Res>(q: PromiseLike<R>, what: string): Promise<NonNullable<Ok<R>>> {
  const res = await q;
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null || res.data === undefined) throw new Error(`${what}: no row`);
  return res.data as NonNullable<Ok<R>>;
}

async function rows<R extends Res>(q: PromiseLike<R>, what: string): Promise<NonNullable<Ok<R>>> {
  const res = await q;
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as NonNullable<Ok<R>>;
}

/** True when a write through the browser key did nothing: refused, or matched no row. */
function refused(res: { error: unknown; data: unknown[] | null }): boolean {
  return res.error !== null || (res.data ?? []).length === 0;
}

const digits = (v: unknown) => String(v).replace(/\D/g, "").slice(-10);

beforeAll(async () => {
  backend = await startBackend();
  [site, model] = await Promise.all([startFakeSite(), startFakeModel()]);
  h.siteUrl = site.url;
  process.env.ANTHROPIC_API_KEY = "sk-ant-e2e";
  process.env.ANTHROPIC_BASE_URL = model.url;
  as(backend.owner);
});

afterAll(async () => {
  await Promise.all([site?.close(), model?.close()]);
  await backend?.close();
});

describe(`a scan from sign-in to fact sheet (${BACKEND})`, () => {
  it("creates the project, crawls the site, and writes a fact sheet with evidence", async () => {
    const res = await createProject(post("/api/projects", { siteUrl: "acme-roofing.example" }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as { projectId: string; runId: string };
    made.projectId = created.projectId;
    made.runId = created.runId;
    const { projectId, runId } = made;

    const { run, steps } = await stepUntilFinished(runId);
    expect(run).toMatchObject({ status: "done", phase: "done", done: true, progress: 1, error: null });
    expect(steps).toBeLessThan(20);

    const project = await row(backend.read.from("projects").select("*").eq("id", projectId).single(), "project");
    expect(project).toMatchObject({
      status: "review",
      site_url: `${SITE_ORIGIN}/`,
      site_host: "acme-roofing.example",
      latest_crawl_run_id: runId,
      user_id: backend.owner.id,
    });

    // robots.txt is respected, and non-HTML links are never requested.
    expect(site.requests).toContain("GET /robots.txt");
    expect(site.requests.some((r) => r.includes("/private/"))).toBe(false);
    expect(site.requests.some((r) => r.includes("brochure.pdf"))).toBe(false);
    // Pages are fetched the way the sitemap spells them, so none costs a redirect hop.
    expect(site.requests.filter((r) => /^GET \/(about-us|services|pricing|contact)$/.test(r))).toEqual([]);

    const pages = await rows(
      backend.read.from("crawl_pages").select("url, status, error, html_path, text_chars").eq("run_id", runId).order("rank"),
      "pages",
    );
    const byPath = new Map(pages.map((p) => [new URL(p.url).pathname, p]));
    expect(byPath.get("/")?.status).toBe("extracted");
    // The menu's old "/about" redirects to "/about-us/", which the sitemap lists: it is read once.
    expect(byPath.get("/about")).toMatchObject({ status: "skipped", error: `same page as ${SITE_ORIGIN}/about-us/` });
    for (const path of ["/about-us/", "/services/", "/contact/"]) {
      expect(byPath.get(path), path).toMatchObject({ status: "extracted" });
    }
    // The model failed on the pricing page twice; the page keeps its deterministic findings and the scan goes on.
    expect(byPath.get("/pricing/")?.status).toBe("failed");
    expect(byPath.get("/pricing/")?.error).toMatch(/^extraction: /);
    // Every fetched page's HTML went to the private bucket.
    for (const p of pages.filter((x) => x.status !== "skipped")) {
      expect(p.html_path, p.url).toMatch(new RegExp(`^${projectId}/${runId}/.+\\.html$`));
      expect(await backend.objectExists("crawl-html", p.html_path ?? ""), p.url).toBe(true);
      expect(p.text_chars).toBeGreaterThan(0);
    }
    made.htmlPath = byPath.get("/")?.html_path ?? "";

    const sheet = await row(
      backend.read.from("fact_sheets").select("id, version, source, data, stats, user_id").eq("crawl_run_id", runId).single(),
      "fact sheet",
    );
    made.sheetId = sheet.id;
    expect(sheet).toMatchObject({ version: 1, source: "crawl", user_id: backend.owner.id });
    expect(project.latest_fact_sheet_id).toBe(sheet.id);

    const f = (sheet.data as unknown as FactSheetData).fields;
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
    expect((sheet.stats as unknown as { findingsDropped: number }).findingsDropped).toBeGreaterThan(0);

    // Every model call is logged with model, tokens, and cost; the run's cost is their sum.
    const calls = await rows(
      backend.read
        .from("llm_calls")
        .select("ok, model, purpose, input_tokens, output_tokens, cost_usd, error, project_id, user_id")
        .eq("run_id", runId),
      "llm calls",
    );
    const ok = calls.filter((c) => c.ok);
    expect(ok).toHaveLength(4);
    expect(calls.filter((c) => !c.ok)).toHaveLength(2);
    for (const c of ok) {
      expect(c).toMatchObject({ model: "claude-haiku-5-5", purpose: "extract_page", project_id: projectId, user_id: backend.owner.id });
      expect(c.input_tokens).toBeGreaterThan(0);
      expect(Number(c.cost_usd)).toBeGreaterThan(0);
    }
    for (const c of calls.filter((x) => !x.ok)) expect(c.error).toMatch(/500/);
    const runRow = await row(backend.read.from("crawl_runs").select("cost_usd").eq("id", runId).single(), "run");
    const sum = calls.reduce((n, c) => n + Number(c.cost_usd), 0);
    expect(Math.abs(Number(runRow.cost_usd) - sum)).toBeLessThan(1e-9);
    expect(model.pages.filter((u) => u.includes("/pricing"))).toHaveLength(2);

    const events = await rows(
      backend.read.from("usage_events").select("kind").eq("project_id", projectId).order("created_at"),
      "usage events",
    );
    expect(events.map((e) => e.kind)).toEqual(["project_created", "crawl_started"]);
  });

  it("keeps every edit when several land on the same fact sheet at once", async () => {
    const { sheetId } = made;
    const before = await row(backend.read.from("fact_sheets").select("data").eq("id", sheetId).single(), "fact sheet");
    const fields = (before.data as unknown as FactSheetData).fields;
    const pick = (fields.phone.candidates ?? []).findIndex((c) => digits(c.value) === "9375550142");
    expect(pick).toBeGreaterThanOrEqual(0);

    const edits = [
      { fieldId: "contract_terms", value: "No contracts. Every job gets a written quote and is paid on completion." },
      { fieldId: "mission", value: "Keep Dayton homes dry." },
      { fieldId: "phone", pickCandidate: pick },
    ];
    const responses = await Promise.all(edits.map((e) => editFactSheet(patch(`/api/fact-sheets/${sheetId}`, e), params(sheetId))));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);

    const after = await row(backend.read.from("fact_sheets").select("data").eq("id", sheetId).single(), "fact sheet");
    const f = (after.data as unknown as FactSheetData).fields;
    expect(f.contract_terms).toMatchObject({ status: "user_provided", value: edits[0].value });
    expect(f.mission).toMatchObject({ status: "user_provided", value: "Keep Dayton homes dry." });
    expect(f.phone.status).toBe("user_provided");
    expect(digits(f.phone.value)).toBe("9375550142");
  });

  it("answers another user's run and fact sheet as not found", async () => {
    const { projectId, runId, sheetId } = made;
    as(backend.other);
    try {
      expect((await readRun(new Request(`http://localhost/api/runs/${runId}`), params(runId))).status).toBe(404);
      expect((await stepRoute(post(`/api/runs/${runId}/step`), params(runId))).status).toBe(404);
      const edit = await editFactSheet(patch(`/api/fact-sheets/${sheetId}`, { fieldId: "mission", value: "Mine now." }), params(sheetId));
      expect(edit.status).toBe(404);
      expect((await startRun(post(`/api/projects/${projectId}/runs`, {}), params(projectId))).status).toBe(404);
    } finally {
      as(backend.owner);
    }
    const sheet = await row(backend.read.from("fact_sheets").select("data").eq("id", sheetId).single(), "fact sheet");
    expect((sheet.data as unknown as FactSheetData).fields.mission.value).toBe("Keep Dayton homes dry.");
  });

  it("re-runs from the stored pages without fetching the site again", async () => {
    const { projectId } = made;
    const siteRequests = site.requests.length;
    const res = await startRun(post(`/api/projects/${projectId}/runs`, { reusePages: true }), params(projectId));
    expect(res.status).toBe(201);
    const { runId: rerunId } = (await res.json()) as { runId: string };

    const { run } = await stepUntilFinished(rerunId);
    expect(run.status).toBe("done");
    expect(site.requests.length).toBe(siteRequests);

    const sheet = await row(backend.read.from("fact_sheets").select("id, version").eq("crawl_run_id", rerunId).single(), "fact sheet");
    expect(sheet.version).toBe(2);
    const project = await row(
      backend.read.from("projects").select("latest_crawl_run_id, latest_fact_sheet_id, status").eq("id", projectId).single(),
      "project",
    );
    expect(project).toEqual({ latest_crawl_run_id: rerunId, latest_fact_sheet_id: sheet.id, status: "review" });
  });

  it("lets one caller step a run at a time", async () => {
    const { projectId } = made;
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
    expect(await rows(backend.read.from("fact_sheets").select("id").eq("crawl_run_id", raceId), "fact sheets")).toHaveLength(1);
  });
});

/*
  Only on Supabase: what Auth, RLS, and Storage do for real. The browser key
  with a session sees the user's own rows and can write none of them; another
  user sees nothing of theirs; the key without a session sees nothing at all.
*/
describe.skipIf(BACKEND !== "supabase")("on Supabase, through the public API", () => {
  it("makes a profile for each new auth user", async () => {
    for (const u of [backend.owner, backend.other]) {
      const profile = await row(backend.read.from("profiles").select("id, email, plan").eq("id", u.id).single(), `profile of ${u.email}`);
      expect(profile).toMatchObject({ id: u.id, email: u.email, plan: "free" });
    }
  });

  it("shows a signed-in user their own rows, which they cannot write", async () => {
    const { projectId, runId, sheetId, htmlPath } = made;
    const me = await signedInClient(backend, backend.owner);
    try {
      const projects = await rows(me.from("projects").select("id, user_id"), "own projects");
      expect(projects.map((p) => p.id)).toContain(projectId);
      expect(projects.every((p) => p.user_id === backend.owner.id)).toBe(true);
      expect((await rows(me.from("crawl_runs").select("id").eq("id", runId), "own run")).map((r) => r.id)).toEqual([runId]);
      expect((await rows(me.from("crawl_pages").select("id").eq("run_id", runId), "own pages")).length).toBeGreaterThan(0);
      expect((await rows(me.from("fact_sheets").select("id").eq("id", sheetId), "own sheet")).map((r) => r.id)).toEqual([sheetId]);
      expect((await rows(me.from("llm_calls").select("id").eq("run_id", runId), "own cost")).length).toBeGreaterThan(0);
      expect((await rows(me.from("templates").select("id"), "templates")).map((t) => t.id)).toContain("about-v1");

      // The plan, a project, a fact sheet, a cost row: every write with the browser key is refused.
      expect(refused(await me.from("profiles").update({ plan: "paid" }).eq("id", backend.owner.id).select("id"))).toBe(true);
      const profile = await row(backend.read.from("profiles").select("plan").eq("id", backend.owner.id).single(), "profile");
      expect(profile.plan).toBe("free");

      const insert = await me
        .from("projects")
        .insert({ user_id: backend.owner.id, site_url: "https://evil.example/", site_host: "evil.example", template_id: "about-v1", mode: "crawl", status: "crawling" })
        .select("id");
      expect(refused(insert)).toBe(true);
      expect(await rows(backend.read.from("projects").select("id").eq("site_host", "evil.example"), "projects")).toEqual([]);

      expect(refused(await me.from("fact_sheets").update({ stats: {} }).eq("id", sheetId).select("id"))).toBe(true);
      const sheet = await row(backend.read.from("fact_sheets").select("stats").eq("id", sheetId).single(), "fact sheet");
      expect(sheet.stats).not.toEqual({});

      expect(
        refused(
          await me
            .from("llm_calls")
            .insert({ user_id: backend.owner.id, purpose: "forged", model: "claude-haiku-5-5", input_tokens: 0, output_tokens: 0, cost_usd: 0, duration_ms: 0, ok: true })
            .select("id"),
        ),
      ).toBe(true);

      // The stored HTML is private: neither a download nor a listing answers.
      expect((await me.storage.from("crawl-html").download(htmlPath)).error).not.toBeNull();
      const listed = await me.storage.from("crawl-html").list(projectId);
      expect(listed.error !== null || listed.data.length === 0).toBe(true);
    } finally {
      await me.auth.signOut();
    }
  });

  it("shows another signed-in user none of it", async () => {
    const { projectId, sheetId, htmlPath } = made;
    const them = await signedInClient(backend, backend.other);
    try {
      expect(await rows(them.from("projects").select("id").eq("id", projectId), "project")).toEqual([]);
      expect(await rows(them.from("crawl_runs").select("id").eq("project_id", projectId), "runs")).toEqual([]);
      expect(await rows(them.from("crawl_pages").select("id").eq("project_id", projectId), "pages")).toEqual([]);
      expect(await rows(them.from("fact_sheets").select("id").eq("id", sheetId), "sheet")).toEqual([]);
      expect(await rows(them.from("llm_calls").select("id").eq("project_id", projectId), "cost")).toEqual([]);
      expect(await rows(them.from("usage_events").select("kind").eq("project_id", projectId), "usage")).toEqual([]);
      // The owner-only delete policy does not reach someone else's project.
      expect(refused(await them.from("projects").delete().eq("id", projectId).select("id"))).toBe(true);
      expect(await rows(backend.read.from("projects").select("id").eq("id", projectId), "project")).toHaveLength(1);
      expect((await them.storage.from("crawl-html").download(htmlPath)).error).not.toBeNull();
    } finally {
      await them.auth.signOut();
    }
  });

  it("shows the publishable key without a session nothing at all", async () => {
    const anon = anonClient(backend);
    for (const table of ["profiles", "projects", "crawl_runs", "crawl_pages", "fact_sheets", "llm_calls", "usage_events", "templates"] as const) {
      const res = await anon.from(table).select("*").limit(5);
      expect(res.error !== null || (res.data ?? []).length === 0, table).toBe(true);
    }
    expect((await anon.storage.from("crawl-html").download(made.htmlPath)).error).not.toBeNull();
    const listed = await anon.storage.from("crawl-html").list("");
    expect(listed.error !== null || listed.data.length === 0).toBe(true);
  });
});
