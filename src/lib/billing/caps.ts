import "server-only";

/*
  Plan allowances. Admin emails are exempt; everyone else gets the caps of
  their plan from config, checked against the counts in usage_events. The
  decision itself (allowanceFor) is pure, so it is tested without a database.
  See docs/build-spec.md, "Caps".
*/
import { config, type PlanId } from "@/config";
import { isAdminEmail } from "@/lib/auth";
import type { Allowance, AllowanceKind } from "@/lib/generate/types";
import { DbError, type Db } from "@/lib/runs/db";
import { crawlsForProject, generationsForProject, monthlyProjects } from "./usage";

export interface AllowanceUser {
  id: string;
  email?: string | null;
}

/** The cap for a plan and kind, from config. */
export function capFor(plan: PlanId, kind: AllowanceKind): number {
  const caps = config.plans[plan];
  if (kind === "project") return caps.projectsPerMonth;
  if (kind === "crawl") return caps.crawlsPerProject;
  return caps.generationsPerProject;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const UPGRADE = "Upgrade, or redeem an access code, on the account page.";
const ASK = `Email ${config.site.supportEmail} if you need more.`;

/** The plain message for a used-up allowance. Names the limit and the plan, and says what to do next. Pure. */
export function capMessage(plan: PlanId, kind: AllowanceKind, limit: number): string {
  const next = plan === "free" ? UPGRADE : ASK;
  if (kind === "project") {
    return `The ${plan} plan allows ${plural(limit, "project")} a month, and you have used ${limit} this month. The allowance resets on the first of the month. ${next}`;
  }
  if (kind === "crawl") {
    return `The ${plan} plan allows ${plural(limit, "scan")} per project, and this project has used ${limit}. ${next}`;
  }
  if (limit === 0) return `The ${plan} plan does not include page generation. ${UPGRADE}`;
  return `The ${plan} plan allows ${plural(limit, "page draft")} per project, and this project has used ${limit}. ${next}`;
}

/** The allowance decision from a count. Pure; checkAllowance adds the database. */
export function allowanceFor(plan: PlanId, kind: AllowanceKind, used: number): Allowance {
  const limit = capFor(plan, kind);
  if (used < limit) return { ok: true, used, limit };
  return { ok: false, used, limit, message: capMessage(plan, kind, limit) };
}

async function planOf(db: Db, userId: string): Promise<PlanId> {
  const res = await db.from("profiles").select("plan").eq("id", userId).maybeSingle();
  if (res.error) throw new DbError("read plan", res.error);
  return res.data?.plan ?? "free";
}

/**
 * Whether the user may start one more of `kind`. Admins are exempt. The
 * project cap counts the current UTC month; the crawl and generation caps
 * count the project, so those two need the project id.
 */
export async function checkAllowance(db: Db, user: AllowanceUser, kind: AllowanceKind, projectId?: string): Promise<Allowance> {
  if (isAdminEmail(user.email)) return { ok: true, used: 0, limit: Number.MAX_SAFE_INTEGER };
  const plan = await planOf(db, user.id);
  let used: number;
  if (kind === "project") {
    used = await monthlyProjects(db, user.id);
  } else {
    if (!projectId) throw new Error(`checkAllowance: a ${kind} check needs the project id`);
    used = kind === "crawl" ? await crawlsForProject(db, projectId) : await generationsForProject(db, projectId);
  }
  return allowanceFor(plan, kind, used);
}
