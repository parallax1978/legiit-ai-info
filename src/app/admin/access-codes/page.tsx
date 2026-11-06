import type { Metadata } from "next";
import { CreateCodeForm } from "@/components/app/admin/create-code-form";
import { PlainTable } from "@/components/app/admin/plain-table";
import { requireAdmin } from "@/lib/auth";
import { listAccessCodeViews } from "@/lib/billing/access-codes";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  title: "Access codes",
  robots: { index: false, follow: false },
};

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function AdminAccessCodesPage() {
  await requireAdmin();
  const codes = await listAccessCodeViews(createServiceClient());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl">Access codes</h2>
        <p className="mt-1 text-sm text-ink-muted">
          A code puts whoever redeems it on the sponsored plan, which has the paid plan&apos;s allowance. Codes are 12
          letters and digits without 0, O, 1, or I.
        </p>
      </div>
      <CreateCodeForm />
      <PlainTable
        columns={["Code", "Label", "Uses", "Last day", "Made"]}
        align={["left", "left", "right", "left", "left"]}
        rows={codes.map((c) => ({
          key: c.id,
          cells: [
            <code key="code" className="font-mono tracking-wider">
              {c.code}
            </code>,
            c.label ?? "",
            `${c.uses} of ${c.max_uses}${c.usedUp ? ", used up" : ""}`,
            c.expires_at ? `${dateFormat.format(new Date(c.expires_at))}${c.expired ? ", expired" : ""}` : "No end",
            dateFormat.format(new Date(c.created_at)),
          ],
        }))}
        empty="No codes yet. Make one above."
      />
    </div>
  );
}
