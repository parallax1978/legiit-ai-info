import type { Metadata } from "next";
import { PlainTable } from "@/components/app/admin/plain-table";
import { requireAdmin } from "@/lib/auth";
import { BY_DAY_DAYS, DASHBOARD_DAYS, formatUsd, loadDashboard, type WindowTotals } from "@/lib/billing/admin";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  title: "Costs",
  robots: { index: false, follow: false },
};

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const metrics: { label: string; cell: (t: WindowTotals) => string }[] = [
  { label: "Spend", cell: (t) => formatUsd(t.spendUsd) },
  { label: "Model calls", cell: (t) => String(t.calls) },
  { label: "Failed calls", cell: (t) => String(t.failedCalls) },
  { label: "New users", cell: (t) => String(t.newUsers) },
  { label: "Projects created", cell: (t) => String(t.projects) },
  { label: "Pages generated", cell: (t) => String(t.generations) },
];

export default async function AdminCostsPage() {
  await requireAdmin();
  const data = await loadDashboard(createServiceClient());
  const windows = data.totals.map((t) => `${t.days} days`);
  const right = (n: number): ("left" | "right")[] => ["left", ...Array.from({ length: n }, () => "right" as const)];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl">Costs</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Every model call from llm_calls over the last {DASHBOARD_DAYS} days, with what it cost. Times are UTC.
        </p>
      </div>

      <PlainTable
        columns={["Metric", ...windows]}
        align={right(windows.length)}
        rows={metrics.map((m) => ({ key: m.label, cells: [m.label, ...data.totals.map((t) => m.cell(t))] }))}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <PlainTable
          caption={`Spend by day, last ${BY_DAY_DAYS} days`}
          columns={["Day", "Calls", "Spend"]}
          align={right(2)}
          rows={data.byDay.map((r) => ({ key: r.key, cells: [r.key, r.calls, formatUsd(r.spendUsd)] }))}
          empty="No calls in this window."
        />
        <div className="space-y-6">
          <PlainTable
            caption="Spend by purpose"
            columns={["Purpose", "Calls", "Spend"]}
            align={right(2)}
            rows={data.byPurpose.map((r) => ({ key: r.key, cells: [r.key, r.calls, formatUsd(r.spendUsd)] }))}
            empty="No calls in this window."
          />
          <PlainTable
            caption="Spend by model"
            columns={["Model", "Calls", "Spend"]}
            align={right(2)}
            rows={data.byModel.map((r) => ({ key: r.key, cells: [r.key, r.calls, formatUsd(r.spendUsd)] }))}
            empty="No calls in this window."
          />
        </div>
      </div>

      <PlainTable
        caption="Top projects by spend"
        columns={["Project", "Owner", "Calls", "Spend"]}
        align={["left", "left", "right", "right"]}
        rows={data.topProjects.map((p) => ({
          key: p.key,
          cells: [p.label, p.ownerEmail ?? "", p.calls, formatUsd(p.spendUsd)],
        }))}
        empty="No calls in this window."
      />

      <PlainTable
        caption={`Failed calls: ${data.failedCount}`}
        columns={["When", "Purpose", "Model", "Error"]}
        rows={data.recentFailed.map((c) => ({
          key: c.id,
          cells: [
            dateTime.format(new Date(c.created_at)),
            c.purpose,
            c.model,
            <span key="error" className="block max-w-md truncate" title={c.error ?? ""}>
              {c.error ?? ""}
            </span>,
          ],
        }))}
        empty="No failed calls."
      />
    </div>
  );
}
