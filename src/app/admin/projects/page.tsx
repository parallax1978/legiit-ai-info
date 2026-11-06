import type { Metadata } from "next";
import { PlainTable } from "@/components/app/admin/plain-table";
import { StatusPill } from "@/components/app/shell/status-pill";
import { requireAdmin } from "@/lib/auth";
import { DASHBOARD_DAYS, formatUsd, loadProjects } from "@/lib/billing/admin";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  title: "Projects",
  robots: { index: false, follow: false },
};

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function AdminProjectsPage() {
  await requireAdmin();
  const projects = await loadProjects(createServiceClient());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl">Projects</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {projects.length} {projects.length === 1 ? "project" : "projects"}. Spend is the cost of the project&apos;s model
          calls over the last {DASHBOARD_DAYS} days.
        </p>
      </div>
      <PlainTable
        columns={["Site", "Owner", "Status", "Scans", "Pages", "Spend", "Made"]}
        align={["left", "left", "left", "right", "right", "right", "left"]}
        rows={projects.map((p) => ({
          key: p.id,
          cells: [
            <span key="site" className="block">
              <span className="block font-medium">{p.label}</span>
              <span className="block max-w-xs truncate text-xs text-ink-muted" title={p.siteUrl}>
                {p.siteUrl}
              </span>
            </span>,
            p.ownerEmail ?? "",
            <StatusPill key="status" status={p.status} />,
            p.runs,
            p.generations,
            formatUsd(p.spendUsd),
            dateFormat.format(new Date(p.createdAt)),
          ],
        }))}
        empty="No projects yet."
      />
    </div>
  );
}
