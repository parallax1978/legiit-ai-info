import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { config } from "@/config";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lede={`The short version of what you agree to when you use ${config.site.name}.`}
      updated="2026-11-05"
      sections={[
        {
          heading: "The service",
          paragraphs: [
            `${config.site.name} reads a website you name, builds a fact sheet from what it finds, and writes an About page, structured data, and install instructions from that fact sheet. The outputs are drafts. You review them and you decide what to publish.`,
            "Only enter a website you own or have permission to work on. The crawler reads up to the limit shown on the new project screen, once per scan, and respects robots.txt.",
          ],
        },
        {
          heading: "Your account and payment",
          paragraphs: [
            `Sign-in is by email link or Google. Keep your email account secure; anyone who can read it can sign in as you.`,
            `The paid plan is $${config.billing.planPriceUsd} a ${config.billing.interval}, billed through Stripe once billing is live, and can be cancelled at any time from your account. Access codes give the same allowance at no charge. Plan limits are shown on the account page.`,
          ],
        },
        {
          heading: "Limits",
          paragraphs: [
            "The outputs are built from what your site says and what you type in. We check that every extracted value has a quote from the site, but we do not guarantee that the result is complete, correct, or fit for a particular purpose, and we make no promise about search engine or AI assistant results.",
            `The service is provided as is. ${config.site.legalOwner}'s liability to you is limited to the amount you paid for the service in the three months before the claim.`,
            <>
              Questions about these terms go to{" "}
              <a href={`mailto:${config.site.supportEmail}`} className="font-medium text-ink hover:underline">
                {config.site.supportEmail}
              </a>
              .
            </>,
          ],
        },
      ]}
    />
  );
}
