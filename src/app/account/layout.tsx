import { AppShell } from "@/components/app/shell/app-shell";
import { isAdminEmail, requireUser } from "@/lib/auth";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/account");
  return (
    <AppShell userEmail={user.email} isAdmin={isAdminEmail(user.email)}>
      {children}
    </AppShell>
  );
}
