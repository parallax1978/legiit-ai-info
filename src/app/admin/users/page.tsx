import type { Metadata } from "next";
import { PlainTable } from "@/components/app/admin/plain-table";
import { requireAdmin } from "@/lib/auth";
import { DASHBOARD_DAYS, formatUsd, loadUsers } from "@/lib/billing/admin";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  title: "Users",
  robots: { index: false, follow: false },
};

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const planLabels = { free: "Free", paid: "Paid", sponsored: "Sponsored" } as const;

export default async function AdminUsersPage() {
  await requireAdmin();
  const users = await loadUsers(createServiceClient());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl">Users</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {users.length} {users.length === 1 ? "account" : "accounts"}. Spend is the cost of their model calls over the last{" "}
          {DASHBOARD_DAYS} days.
        </p>
      </div>
      <PlainTable
        columns={["Email", "Plan", "Projects", "Spend", "Joined"]}
        align={["left", "left", "right", "right", "left"]}
        rows={users.map((u) => ({
          key: u.id,
          cells: [u.email, planLabels[u.plan], u.projects, formatUsd(u.spendUsd), dateFormat.format(new Date(u.createdAt))],
        }))}
        empty="No users yet."
      />
    </div>
  );
}
