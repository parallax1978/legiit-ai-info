import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

/*
  The signed-in frame: header with the app links, a surface-alt main with one
  centered container, footer. Used by /app and /account.
*/
export function AppShell({
  userEmail,
  isAdmin,
  children,
}: {
  userEmail?: string | null;
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader userEmail={userEmail} isAdmin={isAdmin} />
      <main className="flex-1 bg-surface-alt">
        <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
      </main>
      <SiteFooter signedIn={Boolean(userEmail)} />
    </>
  );
}
