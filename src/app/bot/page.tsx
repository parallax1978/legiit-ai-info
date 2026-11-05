import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { config } from "@/config";

export const metadata: Metadata = {
  title: "About the crawler",
  description: "What LegiitAiInfoBot reads, when, and how to block it.",
};

/*
  The page the crawler's User-Agent links to, for site owners who see it in
  their logs.
*/
export default function BotPage() {
  const botName = "LegiitAiInfoBot";
  return (
    <MarketingShell>
      <main className="flex-1 bg-surface-alt">
        <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
          <p className="eyebrow text-brand">For site owners</p>
          <h1 className="mt-2 text-3xl sm:text-4xl">About {botName}</h1>
          <p className="mt-3 text-lg leading-7 text-ink-muted">
            If you saw this user agent in your logs, a customer of {config.site.name} asked us to
            read their website. This page says what the crawler does and how to stop it.
          </p>

          <div className="mt-8 space-y-8 rounded-card border border-line bg-white p-6 shadow-card sm:p-8">
            <section>
              <h2 className="text-lg">What it does</h2>
              <div className="mt-2 space-y-3 text-sm leading-6 text-ink-muted">
                <p>
                  {botName} reads a website once, when a customer enters that site&apos;s address.
                  It does not crawl the web on its own and it does not come back on a schedule. A
                  customer can ask for another read later, which counts as a new visit.
                </p>
                <p>
                  One visit reads at most {config.crawl.maxPages} pages, chosen from the sitemap or
                  from links on the home page: the home page, about, team, contact, pricing, FAQ, and
                  services pages first. Each page is fetched once with a{" "}
                  {Math.round(config.crawl.fetchTimeoutMs / 1000)} second timeout, at most{" "}
                  {config.crawl.parallel} at a time.
                </p>
                <p>
                  The pages are used to build a fact sheet and an About page for that one business.
                  They are kept privately for that customer&apos;s project and are not published or
                  shared.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-lg">How it identifies itself</h2>
              <div className="mt-2 space-y-3 text-sm leading-6 text-ink-muted">
                <p>Every request carries this User-Agent:</p>
                <pre className="overflow-x-auto rounded-lg bg-surface-sunken px-4 py-3 font-mono text-xs text-ink">
                  {config.crawl.userAgent}
                </pre>
              </div>
            </section>

            <section>
              <h2 className="text-lg">How to block it</h2>
              <div className="mt-2 space-y-3 text-sm leading-6 text-ink-muted">
                <p>
                  The crawler reads robots.txt before anything else and follows the rules for its
                  own name and for <code className="font-mono text-ink">*</code>. To keep it off your
                  whole site, add these two lines to your robots.txt:
                </p>
                <pre className="overflow-x-auto rounded-lg bg-surface-sunken px-4 py-3 font-mono text-xs text-ink">
                  {`User-agent: ${botName}\nDisallow: /`}
                </pre>
                <p>
                  To block one folder, put its path after Disallow instead of the slash. A site the
                  crawler may not read cannot be scanned, and the customer is told why.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-lg">Questions</h2>
              <p className="mt-2 text-sm leading-6 text-ink-muted">
                Email{" "}
                <a href={`mailto:${config.site.supportEmail}`} className="font-medium text-ink hover:underline">
                  {config.site.supportEmail}
                </a>{" "}
                with the host name and the time of the visit and we will look it up.
              </p>
            </section>
          </div>
        </article>
      </main>
    </MarketingShell>
  );
}
