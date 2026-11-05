import { config } from "@/config";

const steps = [
  {
    title: "Enter your site",
    text: `We read the pages that matter: home, about, team, contact, pricing, FAQ, and services. Up to ${config.crawl.maxPages} pages, with your robots.txt respected.`,
  },
  {
    title: "Check the facts",
    text: "Each fact is marked found, missing, or contradicted, with its quote and the page it came from. You pick between conflicting values and fill in what the site does not say.",
  },
  {
    title: "Install the page",
    text: "Copy the HTML, copy the schema, and follow the steps for your platform. The instructions name the exact screens and buttons.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-y border-line bg-white">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <p className="eyebrow text-brand">How it works</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">Three steps</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-card border border-line bg-surface-alt p-5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-faint font-bold text-brand-strong">
                {i + 1}
              </span>
              <h3 className="mt-4 text-lg font-bold tracking-tight">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
