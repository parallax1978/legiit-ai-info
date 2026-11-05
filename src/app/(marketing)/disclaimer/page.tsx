import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { config } from "@/config";

export const metadata: Metadata = { title: "Disclaimer" };

export default function DisclaimerPage() {
  return (
    <LegalPage
      title="Disclaimer"
      lede="What the outputs are, and what they are not."
      updated="2026-11-05"
      sections={[
        {
          heading: "The outputs are drafts",
          paragraphs: [
            "The fact sheet, the About page, the structured data, and the instructions are built from what your website says and what you type into the review screen. Every extracted value is checked against a quote from the site, but a site can be out of date or wrong, and the model can misread a page. Read everything before you publish it.",
            "Where the site says nothing, the output asks you a question. It does not fill the gap with a guess. If you answer a question from memory, check the answer against your records.",
          ],
        },
        {
          heading: "No promises about results",
          paragraphs: [
            "We make no promise that an About page or structured data built here will change how search engines or AI assistants describe your business. Nothing on this site is legal, financial, or medical advice.",
            <>
              The service is provided by {config.site.legalOwner}. Questions go to{" "}
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
