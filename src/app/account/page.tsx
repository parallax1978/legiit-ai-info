import type { Metadata } from "next";
import { ManageBillingButton, UpgradeButton } from "@/components/app/account/billing-actions";
import { RedeemCodeForm } from "@/components/app/account/redeem-code-form";
import { Button } from "@/components/ui/button";
import { config, type PlanId } from "@/config";
import { requireUser } from "@/lib/auth";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { monthlyUsage } from "@/lib/billing/usage";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

const planLabels: Record<PlanId, string> = {
  free: "Free",
  paid: `Paid, $${config.billing.planPriceUsd} a ${config.billing.interval}`,
  sponsored: "Sponsored, with an access code",
};

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A read that must not take the page down: null on failure, with the reason in the server log. */
async function quietly<T>(what: string, read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (e) {
    console.error(`${what}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-card border border-line bg-white p-6 shadow-card">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SupportLink() {
  return (
    <a href={`mailto:${config.site.supportEmail}`} className="font-medium text-ink hover:underline">
      {config.site.supportEmail}
    </a>
  );
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser("/account");
  const sp = await searchParams;
  const checkout = first(sp.checkout);

  const supabase = await createClient();
  const [profileRes, usage, redemptionRes] = await Promise.all([
    supabase.from("profiles").select("plan, stripe_customer_id, plan_updated_at").eq("id", user.id).maybeSingle(),
    quietly("read usage", monthlyUsage(supabase, user.id)),
    supabase
      .from("access_code_redemptions")
      .select("created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const profile = profileRes.data;
  const plan: PlanId = profile?.plan ?? "free";
  const caps = config.plans[plan];
  const paid = config.plans.paid;
  const price = config.billing.planPriceUsd;
  const configured = isBillingConfigured();
  const hasCustomer = Boolean(profile?.stripe_customer_id);
  const redeemedAt = redemptionRes.data?.[0]?.created_at ?? null;
  const since = profile?.plan_updated_at ? dateFormat.format(new Date(profile.plan_updated_at)) : null;

  const allowance = [
    { label: "Projects", used: usage ? String(usage.projects) : "", limit: `${caps.projectsPerMonth} a month` },
    { label: "Scans", used: usage ? String(usage.crawls) : "", limit: `${caps.crawlsPerProject} per project` },
    {
      label: "Page drafts",
      used: usage ? String(usage.generations) : "",
      limit: caps.generationsPerProject === 0 ? "Not included" : `${caps.generationsPerProject} per project`,
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl">Account</h1>

      {checkout === "success" ? (
        <p role="status" className="rounded-card bg-good-soft px-4 py-3 text-sm text-good">
          {plan === "paid"
            ? "Thanks. Your plan is now Paid."
            : "Thanks. Your plan changes as soon as Stripe confirms the payment, usually within a minute. Refresh this page if it still says Free."}
        </p>
      ) : checkout === "cancelled" ? (
        <p role="status" className="rounded-card bg-warn-soft px-4 py-3 text-sm text-warn">
          Checkout was cancelled. Nothing was charged.
        </p>
      ) : null}

      <Section title="Plan">
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <dt className="font-semibold text-ink">Email</dt>
          <dd className="text-ink-muted sm:col-span-2">{user.email}</dd>
          <dt className="font-semibold text-ink">Plan</dt>
          <dd className="text-ink-muted sm:col-span-2">
            {planLabels[plan]}
            {since ? <span className="block text-xs text-ink-soft">Since {since}</span> : null}
          </dd>
        </dl>
      </Section>

      <Section title="Allowance">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="eyebrow py-2 text-left text-ink-soft">
                What
              </th>
              <th scope="col" className="eyebrow py-2 text-right text-ink-soft">
                Used this month
              </th>
              <th scope="col" className="eyebrow py-2 text-right text-ink-soft">
                Limit
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {allowance.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-2 text-left font-medium text-ink">
                  {row.label}
                </th>
                <td className="py-2 text-right text-ink-muted tabular-nums">{row.used}</td>
                <td className="py-2 text-right text-ink-muted">{row.limit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-ink-soft">
          {usage
            ? "Used counts what you started this month across your projects. The scan and page draft limits apply to each project."
            : "Your usage did not load. Refresh the page to try again."}
        </p>
      </Section>

      <Section title="Billing">
        {!configured ? (
          <p className="text-sm text-ink-muted">
            Billing is not set up yet. Email <SupportLink /> to change your plan.
          </p>
        ) : plan === "paid" ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              Billed ${price} a month. Change the card, see invoices, or cancel in the billing portal.
            </p>
            <ManageBillingButton />
          </div>
        ) : plan === "sponsored" ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">Your access code covers the paid plan&apos;s allowance, so there is nothing to pay.</p>
            {hasCustomer ? <ManageBillingButton /> : null}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              The paid plan is ${price} a month: {paid.projectsPerMonth} projects a month, {paid.crawlsPerProject} scans and{" "}
              {paid.generationsPerProject} page drafts per project.
            </p>
            <div className="flex flex-wrap gap-2">
              <UpgradeButton label={`Upgrade for $${price} a month`} />
              {hasCustomer ? <ManageBillingButton /> : null}
            </div>
          </div>
        )}
      </Section>

      <Section title="Redeem an access code" id="access-code">
        <p className="text-sm text-ink-muted">
          Students and clients of Legiit get a code. It gives you the same allowance as the paid plan.
        </p>
        <div className="mt-4">
          <RedeemCodeForm />
        </div>
        {redeemedAt ? (
          <p className="mt-3 text-xs text-ink-soft">You redeemed a code on {dateFormat.format(new Date(redeemedAt))}.</p>
        ) : null}
      </Section>

      <form action="/auth/sign-out" method="post">
        <Button type="submit" variant="secondary" size="md">
          Sign out
        </Button>
      </form>
    </div>
  );
}
