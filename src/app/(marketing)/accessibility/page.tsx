import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { config } from "@/config";

export const metadata: Metadata = { title: "Accessibility" };

export default function AccessibilityPage() {
  return (
    <LegalPage
      title="Accessibility"
      lede="What we do so that this site works for everyone, and how to tell us when it does not."
      updated="2026-11-05"
      sections={[
        {
          heading: "What we aim for",
          paragraphs: [
            "Every screen works with a keyboard alone, form fields have labels, images that carry meaning have text alternatives, and text keeps the contrast ratios in WCAG 2.1 level AA. Status is shown with words, not only with color.",
            "The pages we generate for you are plain HTML with headings in order, so they work with screen readers on your own site too.",
          ],
        },
        {
          heading: "Tell us what is wrong",
          paragraphs: [
            <>
              If something on this site does not work for you, email{" "}
              <a href={`mailto:${config.site.supportEmail}`} className="font-medium text-ink hover:underline">
                {config.site.supportEmail}
              </a>{" "}
              with the page and what happened. We fix accessibility problems ahead of other work.
            </>,
          ],
        },
      ]}
    />
  );
}
