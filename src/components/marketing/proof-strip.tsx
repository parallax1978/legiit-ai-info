import { Check } from "lucide-react";
import { config } from "@/config";

const points = [
  `Reads up to ${config.crawl.maxPages} pages`,
  "Every fact shows its quote and source",
  "Shows what is missing and what contradicts itself",
  "Page, schema, and install steps in one pass",
];

export function ProofStrip() {
  return (
    <section className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 text-sm">
        {points.map((p) => (
          <span key={p} className="inline-flex items-center gap-2 text-ink">
            <Check className="h-4 w-4 text-brand" aria-hidden="true" />
            {p}
          </span>
        ))}
        <span className="text-ink-soft sm:ml-auto">From the team behind Legiit</span>
      </div>
    </section>
  );
}
