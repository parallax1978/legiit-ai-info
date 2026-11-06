import type { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  fetchAll,
  failedCalls,
  formatUsd,
  spendBy,
  spendByDay,
  topProjects,
  totalsForWindow,
  utcDay,
  type CallRow,
} from "./admin";

const now = new Date("2026-11-06T12:00:00Z");

function call(partial: Partial<CallRow> & { created_at: string; cost_usd: number }): CallRow {
  return {
    id: `call-${Math.random().toString(36).slice(2)}`,
    user_id: "u1",
    project_id: "p1",
    purpose: "extract_page",
    model: "claude-haiku-5-5",
    ok: true,
    error: null,
    ...partial,
  };
}

const calls: CallRow[] = [
  call({ created_at: "2026-11-06T10:00:00Z", cost_usd: 0.01 }),
  call({ created_at: "2026-11-05T10:00:00Z", cost_usd: 0.02, project_id: "p2", purpose: "write_page", model: "claude-sonnet-5-5" }),
  call({ created_at: "2026-10-20T10:00:00Z", cost_usd: 0.3, ok: false, error: "500 from the API" }),
  call({ created_at: "2026-09-01T10:00:00Z", cost_usd: 1, project_id: null, user_id: null }),
  call({ created_at: "2026-07-01T10:00:00Z", cost_usd: 5 }),
];

describe("totalsForWindow", () => {
  const input = {
    calls,
    profiles: [
      { id: "u1", email: "a@example.com", plan: "free" as const, created_at: "2026-11-01T00:00:00Z" },
      { id: "u2", email: "b@example.com", plan: "paid" as const, created_at: "2026-09-01T00:00:00Z" },
    ],
    projects: [{ id: "p1", user_id: "u1", site_url: "https://a.com/", site_host: "a.com", business_name: null, status: "review" as const, created_at: "2026-11-02T00:00:00Z" }],
    generations: [{ id: "g1", project_id: "p1", user_id: "u1", status: "done" as const, created_at: "2026-10-30T00:00:00Z" }],
  };

  it("sums what falls inside each window", () => {
    expect(totalsForWindow(input, 7, now)).toEqual({ days: 7, spendUsd: 0.03, calls: 2, failedCalls: 0, newUsers: 1, projects: 1, generations: 0 });
    const month = totalsForWindow(input, 30, now);
    expect(month.calls).toBe(3);
    expect(month.failedCalls).toBe(1);
    expect(month.spendUsd).toBeCloseTo(0.33, 6);
    expect(month.generations).toBe(1);
    const quarter = totalsForWindow(input, 90, now);
    expect(quarter.calls).toBe(4);
    expect(quarter.newUsers).toBe(2);
    expect(quarter.spendUsd).toBeCloseTo(1.33, 6);
  });
});

describe("grouping", () => {
  it("groups spend by key, largest first, skipping null keys", () => {
    expect(spendBy(calls, (c) => c.project_id)).toEqual([
      { key: "p1", calls: 3, spendUsd: 5.31 },
      { key: "p2", calls: 1, spendUsd: 0.02 },
    ]);
    expect(topProjects(calls, 1)).toEqual([{ key: "p1", calls: 3, spendUsd: 5.31 }]);
    expect(spendBy(calls, (c) => c.model).map((r) => r.key)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
  });

  it("groups by UTC day, newest first, inside the window", () => {
    expect(spendByDay(calls, 30, now)).toEqual([
      { key: "2026-11-06", calls: 1, spendUsd: 0.01 },
      { key: "2026-11-05", calls: 1, spendUsd: 0.02 },
      { key: "2026-10-20", calls: 1, spendUsd: 0.3 },
    ]);
    expect(utcDay("2026-11-06T23:30:00-05:00")).toBe("2026-11-07");
  });

  it("lists the newest failed calls", () => {
    const failed = failedCalls(calls);
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBe("500 from the API");
  });
});

describe("formatUsd", () => {
  it("shows cents, and four places under a dollar", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0213)).toBe("$0.0213");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(12.345)).toBe("$12.35");
  });
});

describe("fetchAll", () => {
  it("reads page after page until a short one", async () => {
    const all = Array.from({ length: 2_500 }, (_, i) => ({ i }));
    const asked: [number, number][] = [];
    const rows = await fetchAll<{ i: number }>("rows", (from, to) => {
      asked.push([from, to]);
      return Promise.resolve({ data: all.slice(from, to + 1), error: null });
    });
    expect(rows).toHaveLength(2_500);
    expect(asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops at the ceiling and reports a database error", async () => {
    const rows = await fetchAll<{ i: number }>("rows", (from, to) => Promise.resolve({ data: Array.from({ length: to - from + 1 }, (_, i) => ({ i })), error: null }), 2_000);
    expect(rows).toHaveLength(2_000);
    await expect(
      fetchAll("rows", () =>
        Promise.resolve({ data: null, error: { code: "42P01", message: "no such table", details: "", hint: "" } as PostgrestError }),
      ),
    ).rejects.toThrow(/no such table/);
  });
});
