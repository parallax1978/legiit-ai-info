import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill } from "@/components/app/shell/status-pill";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import type { PlatformT } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Projects",
  robots: { index: false, follow: false },
};

const platformLabels: Record<PlatformT, string | null> = {
  wordpress: "WordPress",
  shopify: "Shopify",
  wix: "Wix",
  squarespace: "Squarespace",
  webflow: "Webflow",
  other: "Other platform",
  unknown: null,
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function NewProjectButton({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <Link href="/app/new" className={cn(buttonVariants({ variant: "primary", size }))}>
      New project
    </Link>
  );
}

export default async function ProjectsPage() {
  const user = await requireUser("/app");
  const supabase = await createClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, site_url, site_host, business_name, platform, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl">Projects</h1>
        <NewProjectButton />
      </div>

      {error ? (
        <div className="mt-6 rounded-card border border-line bg-white p-6 shadow-card">
          <p className="eyebrow text-bad">Could not load</p>
          <p className="mt-2 text-ink-muted">
            Your projects did not load. Refresh the page, and if it keeps happening, email help@legiit.com.
          </p>
          <p className="mt-2 text-xs text-ink-soft">{error.message}</p>
        </div>
      ) : projects && projects.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {projects.map((p) => {
            const platform = platformLabels[p.platform];
            return (
              <li key={p.id}>
                <Link
                  href={`/app/projects/${p.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-white px-5 py-4 shadow-card transition-shadow hover:shadow-pop"
                >
                  {/* A full row on phones, so the status, platform, and date wrap under the name. */}
                  <span className="min-w-0 grow basis-full sm:basis-0">
                    <span className="block truncate font-semibold text-ink">
                      {p.business_name || p.site_host || p.site_url}
                    </span>
                    <span className="block truncate text-sm text-ink-muted">{p.site_url}</span>
                  </span>
                  <StatusPill status={p.status} />
                  {platform ? <span className="text-xs font-medium text-ink-muted">{platform}</span> : null}
                  <time dateTime={p.created_at} className="text-xs text-ink-soft">
                    {dateFormat.format(new Date(p.created_at))}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-6 rounded-card border border-line bg-white p-8 shadow-card">
          <p className="eyebrow text-brand">Start here</p>
          <h2 className="mt-2 text-xl">Scan your first site</h2>
          <p className="mt-2 max-w-xl text-ink-muted">
            Enter a website and we read the pages that matter, pull out the facts with a quote and
            source for each one, and show you what is missing before anything gets written.
          </p>
          <div className="mt-6">
            <NewProjectButton size="md" />
          </div>
        </div>
      )}
    </>
  );
}
