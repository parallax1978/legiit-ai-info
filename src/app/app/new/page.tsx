import type { Metadata } from "next";
import { Check } from "lucide-react";
import { NewProjectForm } from "@/components/app/shell/new-project-form";
import { config } from "@/config";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "New project",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser("/app/new");
  const sp = await searchParams;
  const site = (Array.isArray(sp.site) ? sp.site[0] : sp.site)?.trim() ?? "";

  const bullets = [
    {
      title: "What gets read",
      text: `Up to ${config.crawl.maxPages} pages: home, about, team, contact, pricing, FAQ, and services. Your robots.txt is respected.`,
    },
    {
      title: "What you get",
      text: "A fact sheet with the quote and the source page for every value, plus a list of what the site does not say.",
    },
    {
      title: "What it costs",
      text: `One project from your plan's allowance. The free plan covers ${config.plans.free.projectsPerMonth} project a month, the paid plan ${config.plans.paid.projectsPerMonth}.`,
    },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl">New project</h1>
      <p className="mt-2 text-ink-muted">
        Enter the address of the business website, then scan it or fill the facts in by hand.
      </p>

      <div className="mt-6 rounded-card border border-line bg-white p-6 shadow-card sm:p-8">
        <NewProjectForm initialSite={site} />
      </div>

      <ul className="mt-6 space-y-3">
        {bullets.map((b) => (
          <li key={b.title} className="flex gap-3">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-faint">
              <Check className="h-3 w-3 stroke-[3] text-brand" aria-hidden="true" />
            </span>
            <p className="text-sm leading-6 text-ink-muted">
              <span className="font-semibold text-ink">{b.title}.</span> {b.text}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
