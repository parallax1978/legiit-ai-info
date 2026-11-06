import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  isAdminEmail: (email: string | null | undefined) => email === "admin@legiit.com",
}));

import { config, type PlanId } from "@/config";
import type { AllowanceKind } from "@/lib/generate/types";
import { allowanceFor, capFor, capMessage, checkAllowance } from "./caps";
import { fakeDb } from "./fake-db";
import { monthStartUtc } from "./usage";

const PLANS: PlanId[] = ["free", "paid", "sponsored"];
const KINDS: AllowanceKind[] = ["project", "crawl", "generation"];

describe("allowanceFor", () => {
  it.each(PLANS.flatMap((plan) => KINDS.map((kind) => [plan, kind] as const)))(
    "%s plan, %s: allowed below the cap, refused at it",
    (plan, kind) => {
      const limit = capFor(plan, kind);
      if (limit > 0) expect(allowanceFor(plan, kind, limit - 1)).toEqual({ ok: true, used: limit - 1, limit });
      const refused = allowanceFor(plan, kind, limit);
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.used).toBe(limit);
      expect(refused.limit).toBe(limit);
      expect(refused.message).toContain(`${plan} plan`);
      expect(refused.message).not.toMatch(/[–—]/);
    },
  );

  it("takes the caps from config", () => {
    expect(capFor("free", "project")).toBe(config.plans.free.projectsPerMonth);
    expect(capFor("paid", "crawl")).toBe(config.plans.paid.crawlsPerProject);
    expect(capFor("sponsored", "generation")).toBe(config.plans.sponsored.generationsPerProject);
  });

  it("says the free plan has no page generation", () => {
    const a = allowanceFor("free", "generation", 0);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.message).toMatch(/does not include page generation/);
  });

  it("names the limit, and sends free users to upgrade and paid users to support", () => {
    expect(capMessage("paid", "crawl", 5)).toContain("5 scans per project");
    expect(capMessage("free", "project", 1)).toContain("1 project a month");
    expect(capMessage("free", "project", 1)).toContain("account page");
    expect(capMessage("paid", "project", 10)).not.toContain("Upgrade");
    expect(capMessage("paid", "project", 10)).toContain(config.site.supportEmail);
    expect(capMessage("sponsored", "generation", 10)).toContain("10 page drafts per project");
  });
});

describe("checkAllowance", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const monthStart = Date.parse(monthStartUtc());
  const thisMonth = new Date(monthStart + 36 * 3_600_000).toISOString();
  const lastMonth = new Date(monthStart - 36 * 3_600_000).toISOString();
  const projectA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const projectB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("exempts admins without reading anything", async () => {
    const { db } = fakeDb();
    const a = await checkAllowance(db, { id: user, email: "admin@legiit.com" }, "project");
    expect(a).toEqual({ ok: true, used: 0, limit: Number.MAX_SAFE_INTEGER });
  });

  it("counts only this month's projects for the monthly cap", async () => {
    const { db } = fakeDb({
      profiles: [{ id: user, plan: "free" }],
      usage_events: [
        { user_id: user, project_id: projectA, kind: "project_created", created_at: lastMonth },
        { user_id: user, project_id: null, kind: "crawl_started", created_at: thisMonth },
      ],
    });
    expect(await checkAllowance(db, { id: user, email: "x@example.com" }, "project")).toEqual({ ok: true, used: 0, limit: 1 });

    db.from("usage_events");
    const made = fakeDb({
      profiles: [{ id: user, plan: "free" }],
      usage_events: [{ user_id: user, project_id: projectA, kind: "project_created", created_at: thisMonth }],
    });
    const refused = await checkAllowance(made.db, { id: user, email: "x@example.com" }, "project");
    expect(refused.ok).toBe(false);
    expect(refused.used).toBe(1);
  });

  it("counts scans per project", async () => {
    const { db } = fakeDb({
      profiles: [{ id: user, plan: "free" }],
      usage_events: [
        { user_id: user, project_id: projectA, kind: "crawl_started", created_at: lastMonth },
        { user_id: user, project_id: projectA, kind: "crawl_started", created_at: thisMonth },
        { user_id: user, project_id: projectB, kind: "crawl_started", created_at: thisMonth },
      ],
    });
    const a = await checkAllowance(db, { id: user, email: "x@example.com" }, "crawl", projectA);
    expect(a).toMatchObject({ ok: false, used: 2, limit: 2 });
    const b = await checkAllowance(db, { id: user, email: "x@example.com" }, "crawl", projectB);
    expect(b).toEqual({ ok: true, used: 1, limit: 2 });
  });

  it("counts generations per project against the plan", async () => {
    const events = [1, 2, 3].map(() => ({ user_id: user, project_id: projectA, kind: "generation_started", created_at: thisMonth }));
    const paid = fakeDb({ profiles: [{ id: user, plan: "paid" }], usage_events: events });
    expect(await checkAllowance(paid.db, { id: user, email: "x@example.com" }, "generation", projectA)).toEqual({ ok: true, used: 3, limit: 10 });

    const free = fakeDb({ profiles: [{ id: user, plan: "free" }], usage_events: [] });
    const refused = await checkAllowance(free.db, { id: user, email: "x@example.com" }, "generation", projectA);
    expect(refused).toMatchObject({ ok: false, used: 0, limit: 0 });
  });

  it("treats a missing profile as the free plan", async () => {
    const { db } = fakeDb({ profiles: [], usage_events: [] });
    expect(await checkAllowance(db, { id: user, email: null }, "crawl", projectA)).toEqual({ ok: true, used: 0, limit: 2 });
  });

  it("refuses a scan or generation check without a project id", async () => {
    const { db } = fakeDb({ profiles: [{ id: user, plan: "paid" }] });
    await expect(checkAllowance(db, { id: user, email: null }, "crawl")).rejects.toThrow(/project id/);
  });
});
