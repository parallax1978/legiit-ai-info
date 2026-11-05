import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawlRunRow, ProjectRow } from "@/lib/db/types";

/*
  createRun against a scripted db module: the order of its writes decides what
  a failure part way leaves behind, so the tests record every call.
*/

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const runs = new Map<string, Record<string, unknown>>();
  const fail = { usage: false, project: false, pages: false };

  const db = {
    latestReusableRunId: vi.fn(async (): Promise<string | null> => null),
    listReusablePages: vi.fn(async (): Promise<Record<string, unknown>[]> => []),
    getRun: vi.fn(async (_db: unknown, id: string) => runs.get(id) ?? null),
    insertRun: vi.fn(async (_db: unknown, row: Record<string, unknown>) => {
      calls.push("insertRun");
      const run = { id: "run-new", created_at: "2026-11-05T00:00:00Z", ...row };
      runs.set("run-new", run);
      return run;
    }),
    updateRun: vi.fn(async (_db: unknown, id: string, patch: Record<string, unknown>) => {
      calls.push(`updateRun:${String(patch.status ?? patch.phase)}`);
      const run = { ...(runs.get(id) ?? { id }), ...patch };
      runs.set(id, run);
      return run;
    }),
    insertPages: vi.fn(async (_db: unknown, rows: { url: string; normalized_url: string; rank: number }[]) => {
      calls.push("insertPages");
      if (fail.pages) throw new Error("insert pages: connection reset");
      return rows.map((r, i) => ({ id: `page-${i}`, url: r.url, normalized_url: r.normalized_url, rank: r.rank }));
    }),
    insertUsageEvent: vi.fn(async () => {
      calls.push("insertUsageEvent");
      if (fail.usage) throw new Error("insert usage event: connection reset");
    }),
    updateProject: vi.fn(async () => {
      calls.push("updateProject");
      if (fail.project) throw new Error("update project: connection reset");
    }),
  };
  return { calls, runs, fail, db };
});

vi.mock("server-only", () => ({}));
vi.mock("./db", () => h.db);

import { createRun } from "./create";

const project: ProjectRow = {
  id: "proj-1",
  user_id: "user-1",
  site_url: "https://acme.example.com/",
  site_host: "acme.example.com",
  business_name: null,
  platform: "unknown",
  platform_evidence: [],
  template_id: "about-v1",
  mode: "crawl",
  status: "review",
  latest_crawl_run_id: "run-old",
  latest_fact_sheet_id: "sheet-1",
  latest_generation_id: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

const fakeDb = {} as Parameters<typeof createRun>[0];

beforeEach(() => {
  h.calls.length = 0;
  h.runs.clear();
  h.fail.usage = false;
  h.fail.project = false;
  h.fail.pages = false;
  vi.clearAllMocks();
});

describe("createRun", () => {
  it("counts the scan, then points the project at the run", async () => {
    const run = await createRun(fakeDb, project, "user-1");

    expect(run.id).toBe("run-new");
    expect(h.calls).toEqual(["insertRun", "insertUsageEvent", "updateProject"]);
    expect(h.db.updateProject).toHaveBeenCalledWith(fakeDb, "proj-1", { latest_crawl_run_id: "run-new", status: "crawling" });
  });

  it("does not start a scan it could not count, and leaves the project as it was", async () => {
    h.fail.usage = true;

    await expect(createRun(fakeDb, project, "user-1")).rejects.toThrow("usage event");

    expect(h.db.updateProject).not.toHaveBeenCalled();
    expect(h.runs.get("run-new")).toMatchObject({ status: "failed", phase: "failed" });
  });

  it("marks the run failed when the project cannot be pointed at it", async () => {
    h.fail.project = true;

    await expect(createRun(fakeDb, project, "user-1")).rejects.toThrow("update project");

    expect((h.runs.get("run-new") as Partial<CrawlRunRow>).status).toBe("failed");
  });

  it("moves a reuse run to extract only after its pages are in, and fails it if they are not", async () => {
    h.db.latestReusableRunId.mockResolvedValue("run-old");
    h.db.listReusablePages.mockResolvedValue([
      { url: "https://acme.example.com/", normalized_url: "acme.example.com/", rank: 0, text: "Acme", text_chars: 4 },
    ]);

    const run = await createRun(fakeDb, project, "user-1", { reusePages: true });
    expect(h.calls).toEqual(["insertRun", "insertPages", "updateRun:extract", "insertUsageEvent", "updateProject"]);
    expect(run.phase).toBe("extract");

    h.calls.length = 0;
    h.runs.clear();
    h.db.updateProject.mockClear();
    h.fail.pages = true;
    await expect(createRun(fakeDb, project, "user-1", { reusePages: true })).rejects.toThrow("insert pages");
    // Still at discover when it failed, so nothing steps it into an empty merge.
    expect(h.calls).toEqual(["insertRun", "insertPages", "updateRun:failed"]);
    expect(h.db.updateProject).not.toHaveBeenCalled();
  });
});
