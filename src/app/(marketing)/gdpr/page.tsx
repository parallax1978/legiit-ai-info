import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { config } from "@/config";

export const metadata: Metadata = { title: "GDPR" };

export default function GdprPage() {
  return (
    <LegalPage
      title="GDPR"
      lede="How we handle personal data for people in the European Union and the United Kingdom."
      updated="2026-11-05"
      sections={[
        {
          heading: "Who is responsible",
          paragraphs: [
            `${config.site.legalOwner} is the controller for the personal data this site collects: your email address and the data in your projects.`,
            "Our processors are Supabase (accounts and database), Vercel (hosting), Anthropic (the model that reads page text and writes the page), and, once billing is live, Stripe (payment). Each one processes data only to provide its part of the service.",
          ],
        },
        {
          heading: "Why we process it",
          paragraphs: [
            "We process your email address to run your account, which is necessary to provide the service you signed up for. We process the website pages you ask us to read, and what you type in, to build the outputs you asked for.",
            "Pages we read may contain personal data about other people, such as the names and roles of a team. We process that data on your instruction and only to build your page. It is your responsibility to have the right to publish it.",
          ],
        },
        {
          heading: "Your rights",
          paragraphs: [
            <>
              You can ask for a copy of your data, ask us to correct it, or ask us to delete it by emailing{" "}
              <a href={`mailto:${config.site.supportEmail}`} className="font-medium text-ink hover:underline">
                {config.site.supportEmail}
              </a>
              . We answer within one month. You can also complain to your local data protection authority.
            </>,
          ],
        },
      ]}
    />
  );
}
