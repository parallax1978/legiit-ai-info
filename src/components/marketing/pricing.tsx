import Link from "next/link";
import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { config } from "@/config";
import { cn } from "@/lib/utils";

export function Pricing() {
  const price = config.billing.planPriceUsd;
  const paid = config.plans.paid;
  const features = [
    `${paid.projectsPerMonth} projects a month`,
    `${paid.crawlsPerProject} scans per project`,
    `${paid.generationsPerProject} page drafts per project`,
    "The page, the schema, and install steps for your platform",
  ];

  return (
    <section id="pricing" className="bg-white">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <p className="eyebrow text-brand">Pricing</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">One plan, priced to cover costs</h2>
        <p className="mt-3 max-w-2xl text-ink-muted">
          The price covers what it costs to run the model that reads your site and writes the page,
          plus hosting. Students and clients with an access code pay nothing.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="relative rounded-card border-2 border-brand bg-white p-6 shadow-pop">
            <span className="inline-flex rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
              One plan
            </span>
            <p className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">${price}</span>
              <span className="text-ink-muted">/mo</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/login?intent=new"
              className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-6 w-full")}
            >
              Start
            </Link>
          </div>

          <div className="rounded-card border border-line bg-white p-6 shadow-card">
            <span className="inline-flex rounded-full bg-brand-faint px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand-strong uppercase">
              Access code
            </span>
            <p className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">Free</span>
              <span className="text-ink-muted">with a code</span>
            </p>
            <p className="mt-5 text-sm leading-6 text-ink-muted">
              For students and clients of Legiit. Sign in, enter your code, and you get the same
              allowance as the paid plan: {config.plans.sponsored.projectsPerMonth} projects a month
              and {config.plans.sponsored.crawlsPerProject} scans per project.
            </p>
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-6 w-full")}
            >
              Sign in and redeem
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
