import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { config, type PlanId } from "@/config";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

const planLabels: Record<PlanId, string> = {
  free: "Free",
  paid: `Paid, $${config.billing.planPriceUsd} a ${config.billing.interval}`,
  sponsored: "Sponsored (access code)",
};

export default async function AccountPage() {
  const user = await requireUser("/account");
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle();

  const plan: PlanId = profile?.plan ?? "free";
  const caps = config.plans[plan];

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl">Account</h1>

      <dl className="mt-6 divide-y divide-line rounded-card border border-line bg-white shadow-card">
        <div className="grid gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
          <dt className="text-sm font-semibold text-ink">Email</dt>
          <dd className="text-sm text-ink-muted sm:col-span-2">{user.email}</dd>
        </div>
        <div className="grid gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
          <dt className="text-sm font-semibold text-ink">Plan</dt>
          <dd className="text-sm text-ink-muted sm:col-span-2">
            {planLabels[plan]}
            <span className="mt-1 block text-xs text-ink-soft">
              {caps.projectsPerMonth} {caps.projectsPerMonth === 1 ? "project" : "projects"} a month,{" "}
              {caps.crawlsPerProject} scans per project,{" "}
              {caps.generationsPerProject === 0
                ? "no page generation"
                : `${caps.generationsPerProject} page drafts per project`}
              .
            </span>
          </dd>
        </div>
        <div className="grid gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
          <dt className="text-sm font-semibold text-ink">Billing</dt>
          <dd className="text-sm text-ink-muted sm:col-span-2">
            Billing and access codes arrive in a later release. Until then, email{" "}
            <a href={`mailto:${config.site.supportEmail}`} className="font-medium text-ink hover:underline">
              {config.site.supportEmail}
            </a>{" "}
            to change your plan.
          </dd>
        </div>
      </dl>

      <form action="/auth/sign-out" method="post" className="mt-6">
        <Button type="submit" variant="secondary" size="md">
          Sign out
        </Button>
      </form>
    </div>
  );
}
