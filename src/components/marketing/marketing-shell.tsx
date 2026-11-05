import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { getUser, isAdminEmail } from "@/lib/auth";

/*
  Header and footer around a public page. The header switches to the app
  links when the visitor is signed in.
*/
export async function MarketingShell({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <>
      <SiteHeader userEmail={user?.email} isAdmin={isAdminEmail(user?.email)} />
      {children}
      <SiteFooter />
    </>
  );
}
