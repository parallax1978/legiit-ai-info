import { config } from "@/config";
import { FactSheetPreview } from "./fact-sheet-preview";
import { SiteUrlForm } from "./site-url-form";

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="hero-dark overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:py-20 lg:grid-cols-[1.05fr_1fr]">
        <div className="min-w-0">
          <p className="eyebrow text-brand-soft">About page, schema, and install steps</p>
          <h1 className="mt-4 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            An About page AI can trust,
            <span className="text-gradient block">built from your own site.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-white/75">
            Enter your website. We read the pages that matter and pull out the facts, each with a
            quote and the page it came from. You see what is missing and what contradicts itself,
            then get the About page, the schema, and the install steps for your platform.
          </p>
          <SiteUrlForm id="hero-site" signedIn={signedIn} className="mt-8" />
          <p className="mt-3 max-w-md text-xs leading-relaxed text-white/60">
            Reads up to {config.crawl.maxPages} pages and respects robots.txt. Nothing changes on
            your site until you paste the page in yourself.
          </p>
        </div>
        <FactSheetPreview />
      </div>
    </section>
  );
}
