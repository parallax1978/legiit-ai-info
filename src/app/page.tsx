import type { Metadata } from "next";
import { CtaBand } from "@/components/marketing/cta-band";
import { Faq } from "@/components/marketing/faq";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Pricing } from "@/components/marketing/pricing";
import { ProofStrip } from "@/components/marketing/proof-strip";
import { WhatYouGet } from "@/components/marketing/what-you-get";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { config } from "@/config";
import { getUser, isAdminEmail } from "@/lib/auth";

export const metadata: Metadata = {
  title: { absolute: `${config.site.name}: an About page built from your own site` },
  description: config.site.description,
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const user = await getUser();
  const signedIn = Boolean(user);

  return (
    <>
      <SiteHeader userEmail={user?.email} isAdmin={isAdminEmail(user?.email)} />
      <main className="flex-1">
        <Hero signedIn={signedIn} />
        <ProofStrip />
        <HowItWorks />
        <WhatYouGet />
        <Pricing />
        <Faq />
        <CtaBand signedIn={signedIn} />
      </main>
      <SiteFooter signedIn={Boolean(user?.email)} />
    </>
  );
}
