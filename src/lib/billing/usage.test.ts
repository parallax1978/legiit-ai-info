import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fakeDb } from "./fake-db";
import { crawlsForProject, generationsForProject, monthStartUtc, monthlyProjects, monthlyUsage } from "./usage";

describe("monthStartUtc", () => {
  it("is midnight UTC on the first of the month", () => {
    expect(monthStartUtc(new Date("2026-11-06T23:59:59Z"))).toBe("2026-11-01T00:00:00.000Z");
    expect(monthStartUtc(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
    expect(monthStartUtc(new Date("2026-12-31T05:00:00-08:00"))).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("usage counts", () => {
  const user = "u1";
  const other = "u2";
  const now = new Date("2026-11-15T12:00:00Z");
  const { db } = fakeDb({
    usage_events: [
      { user_id: user, project_id: "p1", kind: "project_created", created_at: "2026-11-02T00:00:00.000Z" },
      { user_id: user, project_id: "p2", kind: "project_created", created_at: "2026-10-28T00:00:00.000Z" },
      { user_id: user, project_id: "p1", kind: "crawl_started", created_at: "2026-11-02T00:10:00.000Z" },
      { user_id: user, project_id: "p1", kind: "crawl_started", created_at: "2026-11-03T00:10:00.000Z" },
      { user_id: user, project_id: null, kind: "crawl_started", created_at: "2026-11-04T00:10:00.000Z" },
      { user_id: user, project_id: "p1", kind: "generation_started", created_at: "2026-11-05T00:10:00.000Z" },
      { user_id: other, project_id: "p9", kind: "project_created", created_at: "2026-11-05T00:00:00.000Z" },
      { user_id: other, project_id: "p1", kind: "crawl_started", created_at: "2026-11-05T00:00:00.000Z" },
    ],
  });

  it("counts the user's projects this month only", async () => {
    expect(await monthlyProjects(db, user, now)).toBe(1);
    expect(await monthlyProjects(db, "nobody", now)).toBe(0);
  });

  it("counts a project's scans and generations over its whole life, whoever started them", async () => {
    expect(await crawlsForProject(db, "p1")).toBe(3);
    expect(await generationsForProject(db, "p1")).toBe(1);
    expect(await generationsForProject(db, "p2")).toBe(0);
  });

  it("tallies what the user started this month, including scans on deleted projects", async () => {
    expect(await monthlyUsage(db, user, now)).toEqual({ projects: 1, crawls: 3, generations: 1 });
    expect(await monthlyUsage(db, "nobody", now)).toEqual({ projects: 0, crawls: 0, generations: 0 });
  });
});
