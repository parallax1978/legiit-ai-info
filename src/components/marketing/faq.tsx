import { config } from "@/config";

const rows = [
  {
    q: "Is the AI making this up?",
    a: "No. Every value on the fact sheet has a quote and a link to the page it came from. Anything the site does not say becomes a question for you to answer, never a guess.",
  },
  {
    q: "Do I need to be technical?",
    a: "No. You copy, paste, and follow the steps. The instructions are written for someone who has never opened a code editor.",
  },
  {
    q: "What if my site already has schema?",
    a: "We show it next to the fact sheet, flag anything in it that disagrees with the facts, and tell you which blocks to remove so the two do not conflict.",
  },
  {
    q: "Which platforms?",
    a: "WordPress (block and classic editors), Shopify, Wix, Squarespace, Webflow, and plain HTML.",
  },
  {
    q: "What does it cost to run?",
    a: `$${config.billing.planPriceUsd} a ${config.billing.interval}. That covers the model calls that read your site and write the page, plus hosting. A free account can scan ${config.plans.free.projectsPerMonth} site a month and see the fact sheet; writing the page needs the plan or an access code.`,
  },
  {
    q: "Can my developer see the outputs without an account?",
    a: "Yes. Each project gets a share link that shows the page, the schema, and the instructions without signing in. It arrives with the outputs page.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="bg-surface-alt">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <p className="eyebrow text-brand">Questions</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">Before you start</h2>
        <dl className="mt-8 divide-y divide-line rounded-card border border-line bg-white shadow-card">
          {rows.map((row) => (
            <div key={row.q} className="grid gap-2 px-6 py-5 md:grid-cols-3 md:gap-6">
              <dt className="font-semibold">{row.q}</dt>
              <dd className="text-sm leading-6 text-ink-muted md:col-span-2">{row.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
