import { MarketingShell } from "@/components/marketing/marketing-shell";

/** Header and footer for the public pages that are not the landing page. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <MarketingShell>{children}</MarketingShell>;
}
