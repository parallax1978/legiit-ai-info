import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { config } from "@/config";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lede={`What ${config.site.name} collects, where it goes, and how to reach us about it.`}
      updated="2026-11-05"
      sections={[
        {
          heading: "What we collect",
          paragraphs: [
            "Your email address, used to sign you in and to reach you about your account. There is no password.",
            "The website addresses you enter, and the pages we read from those sites: the extracted text and the raw HTML. We keep the pages so a project can be run again without reading the site a second time.",
            "The fact sheet, the answers you type into the review screen, and the pages and schema that are generated from them. Each model call is logged with its token counts and cost so we can see what the service costs to run.",
          ],
        },
        {
          heading: "Where it goes",
          paragraphs: [
            "Accounts, sign-in, and the database are run on Supabase. The site is hosted on Vercel.",
            "The text of the pages we read, and the fact sheet you approve, are sent to Anthropic to extract facts and to write the page. Anthropic processes that text to answer the request under its API terms.",
            "When billing arrives it will run through Stripe. Card numbers will be entered on Stripe's forms and never stored by us.",
            "We do not sell your data and we do not run advertising on this site.",
          ],
        },
        {
          heading: "Your choices",
          paragraphs: [
            <>
              To see, correct, or delete what we hold about you, email{" "}
              <a href={`mailto:${config.site.supportEmail}`} className="font-medium text-ink hover:underline">
                {config.site.supportEmail}
              </a>
              . Deleting your account removes your projects, the pages we read, and the outputs.
            </>,
            `This site is run by ${config.site.legalOwner}.`,
          ],
        },
      ]}
    />
  );
}
