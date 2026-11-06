import type { Metadata } from "next";
import { AdminNav } from "@/components/app/admin/admin-nav";
import { AppShell } from "@/components/app/shell/app-shell";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/*
  The admin frame: the signed-in shell plus the section pills. Only admin
  emails (ADMIN_EMAILS) get past requireAdmin; everyone else is sent to /app.
  Each page checks again before it reads with the service client, since a
  page can render in parallel with its layout.
*/
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <AppShell userEmail={user.email} isAdmin>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl">Admin</h1>
        <AdminNav />
      </div>
      <div className="mt-6">{children}</div>
    </AppShell>
  );
}
