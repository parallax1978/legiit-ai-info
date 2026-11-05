import { AppShell } from "@/components/app/shell/app-shell";
import { isAdminEmail, requireUser } from "@/lib/auth";

/*
  Wraps every signed-in screen under /app, the project and review screens
  included. Keep it generic: the pages own their headings and containers.
*/
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/app");
  return (
    <AppShell userEmail={user.email} isAdmin={isAdminEmail(user.email)}>
      {children}
    </AppShell>
  );
}
