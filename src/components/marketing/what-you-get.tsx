import { Braces, ClipboardList, FileText, ListChecks, MessageCircleQuestion, Table } from "lucide-react";

const items = [
  {
    icon: FileText,
    title: "The About page",
    text: "A fixed eight-section structure: who you are, what you do, what makes you different, who you serve, the team, how you work, key facts, and questions people ask.",
  },
  {
    icon: Table,
    title: "The Key facts table",
    text: "Phone, address, hours, prices, founding year, and the rest in one table, each value traced to a page on your site.",
  },
  {
    icon: MessageCircleQuestion,
    title: "10 to 12 FAQs",
    text: "Questions your site already answers, each in two or three sentences, repeated word for word in the FAQ schema.",
  },
  {
    icon: Braces,
    title: "JSON-LD schema",
    text: "Organization or LocalBusiness, founders, awards, hours, and FAQPage, built from the same fact sheet as the page so the two never disagree.",
  },
  {
    icon: ClipboardList,
    title: "Install instructions",
    text: "Steps for WordPress, Shopify, Wix, Squarespace, and Webflow, written for someone who has never opened a code editor.",
  },
  {
    icon: ListChecks,
    title: "A still-to-fill list",
    text: "Everything the site does not say, as plain questions. Answer them and the gaps close. Nothing is guessed.",
  },
];

export function WhatYouGet() {
  return (
    <section className="bg-surface-alt">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <p className="eyebrow text-brand">What you get</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">One pass, six outputs</h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {items.map((item) => (
            <li key={item.title} className="rounded-card border border-line bg-white p-5 shadow-card">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-faint text-brand-strong">
                <item.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-base font-bold tracking-tight">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-ink-muted">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
