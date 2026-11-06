/*
  The step machine against an in-memory stand-in for src/lib/runs/db.ts. The
  crawler's network calls and the model call are stubbed; cleaning, merging,
  and the run logic are real. Each "after a kill" case sets up the rows a step
  killed at the function ceiling would leave behind, then steps again.
*/
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

/** What the fetch mock returns: a page, or a failure with no HTML. */
type FetchMockResult = {
  ok: boolean;
  status: number;
  finalUrl: string;
  html: string | null;
  contentType: string;
  bytes: number;
  error?: string;
};

/** The shape the extract mock takes and returns; `model` is null where the real one skips the model. */
type ExtractMockInput = { url: string; text?: string; ctx: { runId: string } };
type ExtractMockResult = {
  findings: { fieldId: string; value: string; quote: string; url: string; source: string; confidence: number }[];
  dropped: number;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  model: string | null;
  summary: string;
  businessNameGuess: string;
};

const h = vi.hoisted(() => {
  class DbError extends Error {
    readonly code: string | null;
    constructor(what: string, code: string | null) {
      super(what);
      this.name = "DbError";
      this.code = code;
    }
  }

  const state = {
    runs: new Map<string, Row>(),
    pages: new Map<string, Row>(),
    projects: new Map<string, Row>(),
    sheets: new Map<string, Row>(),
    llm: [] as Row[],
    seq: 0,
    /** Called before each runs write; may throw to simulate a failure. */
    beforeRunWrite: null as null | ((patch: Row) => void),
  };

  const copy = <T,>(v: T): T => structuredClone(v);
  const id = (prefix: string) => `${prefix}-${++state.seq}`;
  const pagesOf = (runId: string) =>
    [...state.pages.values()].filter((p) => p.run_id === runId).sort((a, b) => Number(a.rank) - Number(b.rank));

  function insertPage(row: Row, ignoreDuplicates: boolean): Row | null {
    const dup = pagesOf(String(row.run_id)).find((p) => p.normalized_url === row.normalized_url);
    if (dup) {
      if (ignoreDuplicates) return null;
      throw new DbError("insert pages: duplicate key value violates unique constraint", "23505");
    }
    const page: Row = {
      id: id("page"),
      status: "queued",
      text: null,
      text_chars: 0,
      findings: null,
      findings_dropped: 0,
      jsonld: [],
      links: {},
      images: [],
      reason: null,
      ...row,
    };
    state.pages.set(String(page.id), page);
    return page;
  }

  const ref = (p: Row) => ({ id: p.id, url: p.url, normalized_url: p.normalized_url, rank: p.rank });

  const fake = {
    DbError,
    async getRun(_db: unknown, runId: string) {
      const r = state.runs.get(runId);
      return r ? copy(r) : null;
    },
    async tryLockRun(_db: unknown, runId: string, token: string, cutoffIso: string, nowIso: string) {
      const r = state.runs.get(runId);
      if (!r) return null;
      if (r.locked_at !== null && String(r.locked_at) >= cutoffIso) return null;
      Object.assign(r, { locked_at: nowIso, lock_token: token });
      return copy(r);
    },
    async updateRunLocked(_db: unknown, runId: string, token: string, patch: Row) {
      const r = state.runs.get(runId);
      if (!r || r.lock_token !== token) return null;
      state.beforeRunWrite?.(patch);
      Object.assign(r, copy(patch));
      return copy(r);
    },
    async updateRun(_db: unknown, runId: string, patch: Row) {
      const r = state.runs.get(runId)!;
      Object.assign(r, copy(patch));
      return copy(r);
    },
    async releaseRun(_db: unknown, runId: string, token: string, extra: Row = {}) {
      const r = state.runs.get(runId);
      if (r && r.lock_token === token) Object.assign(r, copy(extra), { locked_at: null, lock_token: null });
    },
    async getProject(_db: unknown, projectId: string) {
      return copy(state.projects.get(projectId)!);
    },
    async updateProject(_db: unknown, projectId: string, patch: Row) {
      Object.assign(state.projects.get(projectId)!, copy(patch));
    },
    async deletePagesForRun(_db: unknown, runId: string) {
      for (const p of pagesOf(runId)) state.pages.delete(String(p.id));
    },
    async insertPages(_db: unknown, rows: Row[]) {
      return rows.map((r) => ref(insertPage(r, false)!));
    },
    async insertNewPages(_db: unknown, rows: Row[]) {
      return rows.map((r) => insertPage(r, true)).filter((p): p is Row => p !== null).map(ref);
    },
    async listPagesForFetch(_db: unknown, runId: string) {
      return pagesOf(runId).map((p) => ({ ...ref(p), status: p.status, reason: p.reason, text_chars: p.text_chars }));
    },
    async updatePage(_db: unknown, pageId: string, patch: Row) {
      Object.assign(state.pages.get(pageId)!, copy(patch));
    },
    async listPagesForOrder(_db: unknown, runId: string) {
      return pagesOf(runId).map((p) => ({ id: p.id, rank: p.rank, status: p.status }));
    },
    async loadPagesForExtract(_db: unknown, ids: string[]) {
      return ids.map((i) => state.pages.get(i)).filter((p): p is Row => Boolean(p)).map(copy);
    },
    async runLlmCosts(_db: unknown, runId: string) {
      return state.llm.filter((c) => c.run_id === runId).map((c) => ({ cost_usd: c.cost_usd }));
    },
    async loadPagesForMerge(_db: unknown, runId: string) {
      return pagesOf(runId).map(copy);
    },
    async factSheetIdForRun(_db: unknown, runId: string) {
      return [...state.sheets.values()].find((s) => s.crawl_run_id === runId)?.id ?? null;
    },
    async getFactSheetForUser(_db: unknown, sheetId: string, userId: string) {
      const sheet = state.sheets.get(sheetId);
      return sheet && sheet.user_id === userId ? copy(sheet) : null;
    },
    async maxFactSheetVersion(_db: unknown, projectId: string) {
      return Math.max(0, ...[...state.sheets.values()].filter((s) => s.project_id === projectId).map((s) => Number(s.version)));
    },
    async insertFactSheet(_db: unknown, row: Row) {
      if ([...state.sheets.values()].some((s) => s.crawl_run_id && s.crawl_run_id === row.crawl_run_id)) {
        throw new DbError("insert fact sheet: duplicate key", "23505");
      }
      const sheetId = id("sheet");
      state.sheets.set(sheetId, { id: sheetId, ...copy(row) });
      return sheetId;
    },
  };

  const PAGE_HTML = (title: string) =>
    `<html><head><title>${title}</title></head><body><main><h1>Acme Roofing</h1>` +
    `<p>Acme Roofing is a family-run roofing company in Dayton, Ohio. Call 555-123-4567.</p></main></body></html>`;

  const discoverSite = vi.fn(async (siteUrl: string) => ({
    home: siteUrl,
    robots: { raw: null, sitemaps: [] },
    sitemapsRead: ["https://acme.example.com/sitemap.xml"],
    usedSitemap: true,
    queue: [
      { url: "https://acme.example.com/", rank: 0, reason: "home page" },
      { url: "https://acme.example.com/about", rank: 1, reason: "about page" },
      { url: "https://acme.example.com/contact", rank: 2, reason: "contact page" },
    ],
    blockedByRobots: [],
  }));

  const fetchPage = vi.fn(
    async (url: string): Promise<FetchMockResult> => ({
      ok: true,
      status: 200,
      finalUrl: url,
      html: PAGE_HTML(url),
      contentType: "text/html",
      bytes: 400,
    }),
  );

  const extractPage = vi.fn(async (input: ExtractMockInput): Promise<ExtractMockResult> => {
    state.llm.push({ run_id: input.ctx.runId, cost_usd: 0.001 });
    return {
      findings: [
        {
          fieldId: "company_name",
          value: "Acme Roofing",
          quote: "Acme Roofing is a family-run roofing company",
          url: input.url,
          source: "page",
          confidence: 0.9,
        },
        { fieldId: "phone", value: "555-123-4567", quote: "Call 555-123-4567", url: input.url, source: "page", confidence: 0.9 },
      ],
      dropped: 0,
      usage: { inputTokens: 1000, outputTokens: 200 },
      costUsd: 0.001,
      model: "claude-haiku-5-5",
      summary: "",
      businessNameGuess: "Acme Roofing",
    };
  });

  const deterministicFindings = vi.fn(() => [
    { fieldId: "email", value: "hi@acme.example.com", quote: "mailto:hi@acme.example.com", url: "https://acme.example.com/", source: "link", confidence: 0.8 },
  ]);

  return { state, fake, DbError, discoverSite, fetchPage, extractPage, deterministicFindings, PAGE_HTML };
});

vi.mock("server-only", () => ({}));
vi.mock("./db", () => h.fake);
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/storage", () => ({ putHtml: vi.fn(async () => "stored.html") }));
vi.mock("@/lib/extract/page", () => ({
  MIN_TEXT_CHARS: 40,
  extractPage: h.extractPage,
  deterministicFindings: h.deterministicFindings,
}));
vi.mock("@/lib/crawler", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/crawler")>();
  return { ...real, discoverSite: h.discoverSite, fetchPage: h.fetchPage };
});

import { config } from "@/config";
import { StructuredCallError } from "@/lib/llm/structured";
import { pageKey } from "./logic";
import { stepRun } from "./step";

const USER = "user-1";
const PROJECT = "project-1";
const RUN = "run-1";

function seed(opts: { run?: Row; project?: Row } = {}) {
  h.state.runs.set(RUN, {
    id: RUN,
    project_id: PROJECT,
    user_id: USER,
    status: "queued",
    phase: "discover",
    cursor: { homeUrl: "https://acme.example.com/" },
    pages_planned: 0,
    pages_fetched: 0,
    pages_failed: 0,
    pages_extracted: 0,
    text_bytes: 0,
    platform: "unknown",
    platform_evidence: [],
    robots: null,
    sitemaps: [],
    log: [],
    error: null,
    locked_at: null,
    lock_token: null,
    started_at: null,
    finished_at: null,
    cost_usd: 0,
    fact_sheet_id: null,
    created_at: "2026-11-05T00:00:00.000Z",
    updated_at: "2026-11-05T00:00:00.000Z",
    ...opts.run,
  });
  h.state.projects.set(PROJECT, {
    id: PROJECT,
    user_id: USER,
    site_url: "https://acme.example.com/",
    site_host: "acme.example.com",
    business_name: null,
    platform: "unknown",
    platform_evidence: [],
    template_id: "about-v1",
    mode: "crawl",
    status: "crawling",
    latest_crawl_run_id: RUN,
    latest_fact_sheet_id: null,
    latest_generation_id: null,
    ...opts.project,
  });
}

function addPage(row: Row): string {
  const pageId = `page-seed-${row.rank}`;
  h.state.pages.set(pageId, {
    id: pageId,
    run_id: RUN,
    project_id: PROJECT,
    user_id: USER,
    normalized_url: pageKey(String(row.url)),
    reason: null,
    text: null,
    text_chars: 0,
    findings: null,
    findings_dropped: 0,
    jsonld: [],
    links: {},
    images: [],
    title: null,
    meta_description: null,
    canonical: null,
    lang: null,
    ...row,
  });
  return pageId;
}

async function stepUntilFinished(max = 30) {
  for (let i = 0; i < max; i++) {
    const { run } = await stepRun(RUN, USER);
    if (run.status === "done" || run.status === "failed") return run;
  }
  throw new Error("the run did not finish");
}

const run = () => h.state.runs.get(RUN)!;
const project = () => h.state.projects.get(PROJECT)!;
const pages = () => [...h.state.pages.values()].filter((p) => p.run_id === RUN);

beforeEach(() => {
  h.state.runs.clear();
  h.state.pages.clear();
  h.state.projects.clear();
  h.state.sheets.clear();
  h.state.llm.length = 0;
  h.state.beforeRunWrite = null;
  vi.clearAllMocks();
});

describe("stepRun, the happy path", () => {
  it("walks discover, fetch, extract, merge and points the project at the fact sheet", async () => {
    seed();
    const finished = await stepUntilFinished();

    expect(finished.status).toBe("done");
    expect(finished.factSheetId).toBeTruthy();
    expect(pages().map((p) => p.status)).toEqual(["extracted", "extracted", "extracted"]);
    expect(run()).toMatchObject({ pages_planned: 3, pages_fetched: 3, pages_extracted: 3, cost_usd: 0.003, locked_at: null });

    const sheet = h.state.sheets.get(String(run().fact_sheet_id))!;
    const fields = (sheet.data as { fields: Record<string, { status: string; value: unknown }> }).fields;
    expect(fields.company_name).toMatchObject({ status: "found", value: "Acme Roofing" });
    expect(project()).toMatchObject({
      status: "review",
      latest_fact_sheet_id: sheet.id,
      business_name: "Acme Roofing",
    });
  });

  it("keeps the owner's edits from the project's last fact sheet on a re-run", async () => {
    const typed = {
      value: "No contracts. Every job gets a written quote.",
      status: "user_provided",
      evidence: [{ quote: "No contracts. Every job gets a written quote.", url: "", source: "user" }],
      updatedAt: "2026-11-05T12:00:00.000Z",
    };
    const renamed = {
      value: "Acme Roofing LLC",
      status: "user_provided",
      evidence: [{ quote: "Acme Roofing LLC", url: "", source: "user" }],
      crawled: { value: "Acme Roofing", status: "found", evidence: [] },
    };
    h.state.sheets.set("sheet-prev", {
      id: "sheet-prev",
      project_id: PROJECT,
      user_id: USER,
      crawl_run_id: "run-earlier",
      version: 1,
      data: { templateId: "about-v1", fields: { contract_terms: typed, company_name: renamed } },
    });
    // Starting the re-run already pointed the project at this run; the sheet pointer is still the old one.
    seed({ project: { latest_fact_sheet_id: "sheet-prev", status: "review" } });

    const finished = await stepUntilFinished();
    expect(finished.status).toBe("done");

    const sheet = h.state.sheets.get(String(run().fact_sheet_id))!;
    expect(sheet.id).not.toBe("sheet-prev");
    expect(sheet.version).toBe(2);
    const fields = (sheet.data as { fields: Record<string, Record<string, unknown>> }).fields;
    expect(fields.contract_terms).toMatchObject({ status: "user_provided", value: typed.value, updatedAt: typed.updatedAt });
    expect(fields.contract_terms.crawled).toMatchObject({ status: "missing", value: null });
    // The edited name stays, and what this scan found sits under crawled.
    expect(fields.company_name).toMatchObject({ status: "user_provided", value: "Acme Roofing LLC" });
    expect(fields.company_name.crawled).toMatchObject({ status: "found", value: "Acme Roofing" });
    expect((sheet.stats as { userProvided: number }).userProvided).toBe(2);
    expect(project()).toMatchObject({ latest_fact_sheet_id: sheet.id, business_name: "Acme Roofing LLC" });
    expect((run().log as { message: string }[]).map((l) => l.message)).toContain("Kept the 2 fields you edited on the last fact sheet.");
  });
});

describe("stepRun when a page redirects to another page of the run", () => {
  const HOME = "https://acme.example.com/";
  const OLD = "https://acme.example.com/about";
  const LIVE = "https://acme.example.com/about-us/";

  function seedRedirect() {
    seed({
      run: {
        status: "running",
        phase: "fetch",
        pages_planned: 3,
        cursor: {
          homeUrl: HOME,
          usedSitemap: true,
          queue: [
            { url: HOME, rank: 0, reason: "home page" },
            { url: OLD, rank: 1, reason: "about page" },
            { url: LIVE, rank: 2, reason: "about page" },
          ],
          seen: [HOME, OLD, LIVE],
          nextRank: 3,
        },
      },
    });
    addPage({ url: HOME, rank: 0, status: "queued" });
    addPage({ url: OLD, rank: 1, status: "queued" });
    addPage({ url: LIVE, rank: 2, status: "queued" });
  }
  const page = (url: string) => pages().find((p) => p.url === url);

  it("reads the page once, under the address it lands on", async () => {
    seedRedirect();
    h.fetchPage.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      finalUrl: url === OLD ? LIVE : url,
      html: h.PAGE_HTML(url),
      contentType: "text/html",
      bytes: 400,
    }));

    await stepRun(RUN, USER);
    h.fetchPage.mockReset();

    expect(page(OLD)).toMatchObject({ status: "skipped", error: `same page as ${LIVE}` });
    expect(page(LIVE)).toMatchObject({ status: "fetched" });
    expect(run()).toMatchObject({ phase: "extract", pages_fetched: 2 });
    expect((run().cursor as { extractQueue?: string[] }).extractQueue).not.toContain(OLD);
  });

  it("keeps the redirecting page when the page it lands on could not be read", async () => {
    seedRedirect();
    h.fetchPage.mockImplementation(async (url: string) =>
      url === LIVE
        ? { ok: false, status: 500, finalUrl: url, html: null, contentType: "text/html", bytes: 0, error: "HTTP 500" }
        : { ok: true, status: 200, finalUrl: url === OLD ? LIVE : url, html: h.PAGE_HTML(url), contentType: "text/html", bytes: 400 },
    );

    await stepRun(RUN, USER);
    h.fetchPage.mockReset();

    expect(page(OLD)).toMatchObject({ status: "fetched" });
    expect(page(LIVE)).toMatchObject({ status: "failed" });
  });
});

describe("stepRun after a step that was cut off", () => {
  it("rebuilds the fetch queue from the rows instead of the stale cursor", async () => {
    // The cut-off try fetched the home page and queued two links it found, then died
    // before saving the cursor, which still says only the home page is left.
    seed({
      run: {
        status: "running",
        phase: "fetch",
        pages_planned: 1,
        cursor: {
          homeUrl: "https://acme.example.com/",
          usedSitemap: false,
          queue: [{ url: "https://acme.example.com/", rank: 0, reason: "home page" }],
          seen: ["https://acme.example.com/"],
          nextRank: 1,
        },
      },
    });
    addPage({ url: "https://acme.example.com/", rank: 0, status: "fetched", text: "Acme Roofing", text_chars: 12 });
    addPage({ url: "https://acme.example.com/about", rank: 1, status: "queued" });
    addPage({ url: "https://acme.example.com/team", rank: 2, status: "queued" });

    await stepRun(RUN, USER);

    const fetchedUrls = h.fetchPage.mock.calls.map((c) => c[0]);
    expect(fetchedUrls).toEqual(["https://acme.example.com/about", "https://acme.example.com/team"]);
    expect(pages().filter((p) => p.status === "fetched")).toHaveLength(3);
    expect(run()).toMatchObject({ phase: "extract", pages_planned: 3, pages_fetched: 3 });
  });

  it("does not trip the unique constraint on link rows an earlier try already inserted", async () => {
    seed({
      run: {
        status: "running",
        phase: "fetch",
        cursor: {
          homeUrl: "https://acme.example.com/",
          usedSitemap: false,
          queue: [{ url: "https://acme.example.com/", rank: 0, reason: "home page" }],
          seen: ["https://acme.example.com/"],
        },
      },
    });
    addPage({ url: "https://acme.example.com/", rank: 0, status: "queued" });
    addPage({ url: "https://acme.example.com/about", rank: 1, status: "queued" });
    h.fetchPage.mockImplementationOnce(async (url: string) => ({
      ok: true,
      status: 200,
      finalUrl: url,
      html: '<html><body><main><p>Home</p><a href="/about">About us</a><a href="/pricing">Pricing</a></main></body></html>',
      contentType: "text/html",
      bytes: 100,
    }));

    await stepRun(RUN, USER);

    expect(run().error).toBeNull();
    const urls = pages().map((p) => p.normalized_url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain(pageKey("https://acme.example.com/pricing"));
  });

  it("does not send a page an earlier try already extracted to the model again", async () => {
    seed({ run: { status: "running", phase: "extract", pages_fetched: 2 } });
    const done = addPage({ url: "https://acme.example.com/", rank: 0, status: "extracted", findings: [], text: "Acme Roofing" });
    const todo = addPage({ url: "https://acme.example.com/about", rank: 1, status: "fetched", text: "Acme Roofing is a family-run roofing company" });
    Object.assign(run(), { cursor: { homeUrl: "https://acme.example.com/", extractQueue: [done, todo] } });

    await stepRun(RUN, USER);

    expect(h.extractPage).toHaveBeenCalledTimes(1);
    expect(h.extractPage.mock.calls[0][0].url).toBe("https://acme.example.com/about");
    expect(run()).toMatchObject({ phase: "merge", pages_extracted: 2 });
  });

  it("reuses the fact sheet a cut-off merge already wrote", async () => {
    seed({ run: { status: "running", phase: "merge" } });
    addPage({ url: "https://acme.example.com/", rank: 0, status: "extracted", findings: [] });
    h.state.sheets.set("sheet-old", { id: "sheet-old", project_id: PROJECT, crawl_run_id: RUN, version: 1 });

    const { run: view } = await stepRun(RUN, USER);

    expect(view.status).toBe("done");
    expect(h.state.sheets.size).toBe(1);
    expect(run().fact_sheet_id).toBe("sheet-old");
    expect(project()).toMatchObject({ status: "review", latest_fact_sheet_id: "sheet-old" });
  });

  it("fails a phase that keeps being cut off instead of retrying forever", async () => {
    seed({ run: { status: "running", phase: "discover", cursor: { attempts: config.crawl.maxStepAttempts } } });

    const { run: view } = await stepRun(RUN, USER);

    expect(view.status).toBe("failed");
    expect(run().error).toContain("running out of time while finding the pages");
    expect(h.discoverSite).not.toHaveBeenCalled();
    expect(project().status).toBe("failed");
  });

  it("counts the attempt before doing any work, so a killed step still counts", async () => {
    seed();
    h.discoverSite.mockImplementationOnce(async () => {
      // What the platform's kill looks like from the database: the step's own writes stop here.
      throw Object.assign(new Error("killed"), { name: "Killed" });
    });
    h.state.beforeRunWrite = (patch) => {
      if ((patch.log as unknown[] | undefined)?.length) throw new Error("the process is gone");
    };

    await stepRun(RUN, USER).catch(() => undefined);

    expect((run().cursor as { attempts?: number }).attempts).toBe(1);
  });
});

describe("stepRun and the lock", () => {
  it("returns locked while another step holds an unexpired lease", async () => {
    seed({ run: { locked_at: new Date().toISOString(), lock_token: "someone-else" } });
    const result = await stepRun(RUN, USER);
    expect(result.locked).toBe(true);
    expect(h.discoverSite).not.toHaveBeenCalled();
  });

  it("stops without writing when the lease passes to another caller mid-step", async () => {
    seed();
    h.discoverSite.mockImplementationOnce(async (siteUrl: string) => {
      // Another caller takes the lock while discovery is still running.
      Object.assign(run(), { lock_token: "newer-step", locked_at: new Date().toISOString() });
      return {
        home: siteUrl,
        robots: { raw: null, sitemaps: [] },
        sitemapsRead: [],
        usedSitemap: true,
        queue: [{ url: siteUrl, rank: 0, reason: "home page" }],
        blockedByRobots: [],
      };
    });

    const result = await stepRun(RUN, USER);

    expect(result.locked).toBe(true);
    expect(run()).toMatchObject({ phase: "discover", lock_token: "newer-step" });
  });
});

describe("stepRun failures", () => {
  it("keeps a reviewed project in review when a re-run fails", async () => {
    seed({ project: { status: "crawling", latest_fact_sheet_id: "sheet-v1" } });
    h.discoverSite.mockImplementation(async () => {
      throw new Error("the site is down");
    });

    const finished = await stepUntilFinished();

    expect(finished.status).toBe("failed");
    expect(run().error).toBe("the site is down");
    expect(project()).toMatchObject({ status: "review", latest_fact_sheet_id: "sheet-v1" });
    h.discoverSite.mockReset();
  });

  it("fails the run instead of writing an all-missing fact sheet when no page could be read for facts", async () => {
    seed({ run: { status: "running", phase: "merge" }, project: { latest_fact_sheet_id: "sheet-v1", status: "review" } });
    addPage({ url: "https://acme.example.com/", rank: 0, status: "failed", findings: [], text_chars: 4200 });

    const { run: view } = await stepRun(RUN, USER);

    expect(view.status).toBe("failed");
    expect(h.state.sheets.size).toBe(0);
    expect(project()).toMatchObject({ status: "review", latest_fact_sheet_id: "sheet-v1" });
  });

  it("keeps a page's JSON-LD and link findings when its model call fails for good", async () => {
    seed({ run: { status: "running", phase: "extract", pages_fetched: 1 } });
    const only = addPage({ url: "https://acme.example.com/", rank: 0, status: "fetched", text: "Acme Roofing home page text" });
    Object.assign(run(), {
      cursor: { homeUrl: "https://acme.example.com/", extractQueue: [only], extractAttempts: { [only]: 1 } },
    });
    h.extractPage.mockImplementationOnce(async () => {
      throw new Error("model timed out");
    });

    await stepRun(RUN, USER);

    const page = h.state.pages.get(only)!;
    expect(page.status).toBe("failed");
    expect(page.findings).toEqual([expect.objectContaining({ fieldId: "email" })]);
    expect(run().phase).toBe("merge");
  });

  it("does not move the project's pointers from a run that a newer run replaced", async () => {
    seed({ run: { status: "running", phase: "merge" }, project: { latest_crawl_run_id: "run-newer", latest_fact_sheet_id: "sheet-v1" } });
    addPage({ url: "https://acme.example.com/", rank: 0, status: "extracted", findings: [] });

    await stepRun(RUN, USER);

    expect(run().status).toBe("done");
    expect(project()).toMatchObject({ latest_crawl_run_id: "run-newer", latest_fact_sheet_id: "sheet-v1" });
  });
});

describe("stepRun and unusable model answers", () => {
  const cutOff = () =>
    new StructuredCallError("max_tokens", "The output was cut off at max_tokens.", {
      usage: { inputTokens: 5000, outputTokens: 16000 },
      costUsd: 0.0085,
      durationMs: 30_000,
      model: "claude-haiku-5-5",
      stopReason: "max_tokens",
    });

  it("does not retry a page whose answer was cut off at max_tokens", async () => {
    seed({ run: { status: "running", phase: "extract", pages_fetched: 1 } });
    const only = addPage({ url: "https://acme.example.com/team", rank: 0, status: "fetched", text: "A very long team page" });
    Object.assign(run(), { cursor: { homeUrl: "https://acme.example.com/", extractQueue: [only] } });
    h.extractPage.mockImplementationOnce(async () => {
      throw cutOff();
    });

    await stepRun(RUN, USER);

    expect(h.state.pages.get(only)!.status).toBe("failed");
    expect(run().phase).toBe("merge");
    expect((run().cursor as { extractQueue: string[] }).extractQueue).toEqual([]);
  });

  it("treats a batch of unusable answers as page problems, not a step error", async () => {
    seed({ run: { status: "running", phase: "extract", pages_fetched: 2 } });
    const a = addPage({ url: "https://acme.example.com/a", rank: 0, status: "fetched", text: "Page a text here" });
    const b = addPage({ url: "https://acme.example.com/b", rank: 1, status: "fetched", text: "Page b text here" });
    Object.assign(run(), { cursor: { homeUrl: "https://acme.example.com/", extractQueue: [a, b] } });
    h.extractPage.mockImplementation(async () => {
      throw cutOff();
    });

    await stepRun(RUN, USER);
    h.extractPage.mockReset();

    expect((run().cursor as { errorCount?: number }).errorCount ?? 0).toBe(0);
    expect([h.state.pages.get(a)!.status, h.state.pages.get(b)!.status]).toEqual(["failed", "failed"]);
  });

  it("still treats a batch of failed requests as a step error", async () => {
    seed({ run: { status: "running", phase: "extract", pages_fetched: 2 } });
    const a = addPage({ url: "https://acme.example.com/a", rank: 0, status: "fetched", text: "Page a has enough text to need a model call, well over forty characters." });
    const b = addPage({ url: "https://acme.example.com/b", rank: 1, status: "fetched", text: "Page b has enough text to need a model call, well over forty characters." });
    Object.assign(run(), { cursor: { homeUrl: "https://acme.example.com/", extractQueue: [a, b] } });
    h.extractPage.mockImplementation(async () => {
      throw new Error("ANTHROPIC_API_KEY is not set");
    });

    await stepRun(RUN, USER);
    h.extractPage.mockReset();

    expect((run().cursor as { errorCount?: number }).errorCount).toBe(1);
    expect(h.state.pages.get(a)!.status).toBe("fetched");
  });
});

describe("stepRun when the model is down on a site with short pages", () => {
  it("fails the run instead of replacing a reviewed sheet with one the model never read", async () => {
    seed({
      run: { status: "running", phase: "extract", pages_fetched: 4 },
      project: { status: "review", latest_fact_sheet_id: "sheet-v1" },
    });
    const home = addPage({ url: "https://acme.example.com/", rank: 0, status: "fetched", text: "Acme Roofing is a family-run roofing company in Dayton. ".repeat(20), text_chars: 1100 });
    const shells = ["/about", "/contact", "/services"].map((p, i) =>
      addPage({ url: `https://acme.example.com${p}`, rank: i + 1, status: "fetched", text: "# About", text_chars: 7 }),
    );
    Object.assign(run(), { cursor: { homeUrl: "https://acme.example.com/", extractQueue: [home, ...shells] } });
    // The real extractPage skips the model under 40 characters; the long page's call fails.
    h.extractPage.mockImplementation(async (input: { url: string; text?: string }) => {
      if ((input.text ?? "").length < 40) {
        return { findings: [], dropped: 0, usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, model: null, summary: "", businessNameGuess: "" };
      }
      throw new Error("Connection error.");
    });

    const finished = await stepUntilFinished();
    h.extractPage.mockReset();

    expect(finished.status).toBe("failed");
    expect(h.state.sheets.size).toBe(0);
    expect(project()).toMatchObject({ status: "review", latest_fact_sheet_id: "sheet-v1" });
  });

  it("writes the sheet when every page is a short shell, since there was nothing for the model to read", async () => {
    seed({ run: { status: "running", phase: "merge" } });
    addPage({ url: "https://acme.example.com/", rank: 0, status: "extracted", findings: [], text_chars: 12, extract_tokens_out: 0 });

    const { run: view } = await stepRun(RUN, USER);

    expect(view.status).toBe("done");
    expect(h.state.sheets.size).toBe(1);
  });
});
