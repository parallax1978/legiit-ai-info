import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { config } from "@/config";

export const metadata: Metadata = { title: "Cookie Policy" };

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      lede="The cookies this site sets and what they are for."
      updated="2026-11-05"
      sections={[
        {
          heading: "Sign-in cookies",
          paragraphs: [
            "When you sign in, Supabase sets cookies that hold your session so you stay signed in between pages. They are needed for the signed-in part of the site to work and they are removed when you sign out.",
            "While a Google sign-in is in progress a short-lived cookie holds the code that completes it.",
          ],
        },
        {
          heading: "Nothing else",
          paragraphs: [
            "There are no advertising cookies and no third-party analytics cookies on this site. If that changes, this page will say so, with the date.",
            <>
              Questions go to{" "}
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
