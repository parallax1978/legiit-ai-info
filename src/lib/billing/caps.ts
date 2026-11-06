import "server-only";

/*
  Plan allowances. Admins are exempt; everyone else gets the caps of their
  plan from config. See docs/build-spec.md; the billing builder replaces the
  stub with real counts from usage_events.
*/
import { config, type PlanId } from "@/config";
import { isAdminEmail } from "@/lib/auth";
import type { Allowance, AllowanceKind } from "@/lib/generate/types";
import type { Db } from "@/lib/runs/db";

export interface AllowanceUser {
  id: string;
  email?: string | null;
}

export async function checkAllowance(db: Db, user: AllowanceUser, kind: AllowanceKind, projectId?: string): Promise<Allowance> {
  void projectId;
  if (isAdminEmail(user.email)) return { ok: true, used: 0, limit: Number.MAX_SAFE_INTEGER };
  const { data } = await db.from("profiles").select("plan").eq("id", user.id).maybeSingle();
  const plan: PlanId = data?.plan ?? "free";
  const caps = config.plans[plan];
  const limit = kind === "project" ? caps.projectsPerMonth : kind === "crawl" ? caps.crawlsPerProject : caps.generationsPerProject;
  if (limit === 0) {
    return { ok: false, used: 0, limit, message: "The free plan does not include page generation. Upgrade, or redeem an access code, on the account page." };
  }
  return { ok: true, used: 0, limit };
}
