import { CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  An excerpt of the Legiit fact sheet from a scan of legiit.com on 2026-11-06:
  real values, real quotes, and the gap and the contradiction the scan found.
*/
type Row = {
  status: "found" | "conflict" | "missing";
  label: string;
  value: string;
  detail: string;
  source?: string;
};

const rows: Row[] = [
  {
    status: "found",
    label: "Founded",
    value: "February 7, 2018",
    detail: "“Legiit launched on February 7, 2018.”",
    source: "about page",
  },
  {
    status: "found",
    label: "Pricing",
    value: "from $6 an order",
    detail: "“Orders start at $6, the average order is about $90, and the largest buyers spend on average $30,000 a month.”",
    source: "about page",
  },
  {
    status: "conflict",
    label: "Free offer",
    value: "“first 7 days free” on the About page, “Early savings start now” on the SEO page",
    detail: "Pick one, or type the offer.",
  },
  {
    status: "missing",
    label: "Response time",
    value: "not on the site",
    detail: "How quickly does the business respond to a message, and is support available around the clock?",
  },
];

const pill: Record<Row["status"], { label: string; className: string; dot: string }> = {
  found: { label: "Found", className: "bg-good-soft text-good", dot: "bg-good" },
  conflict: { label: "Conflict", className: "bg-warn-soft text-warn", dot: "bg-warn" },
  missing: { label: "Missing", className: "bg-bad-soft text-bad", dot: "bg-bad" },
};

export function FactSheetPreview() {
  return (
    <div className="relative mx-auto w-full min-w-0 max-w-lg lg:max-w-none">
      <div className="absolute -inset-6 rounded-[2rem] bg-brand/40 blur-3xl" aria-hidden="true" />
      <div className="relative rounded-2xl border border-white/10 bg-white p-5 text-ink shadow-pop sm:p-6">
        <p className="eyebrow text-brand">Fact sheet</p>
        <p className="mt-1 text-lg font-bold tracking-tight">Legiit</p>
        <ul className="mt-4 divide-y divide-line">
          {rows.map((row) => {
            const p = pill[row.status];
            return (
              <li key={row.label} className="flex gap-3 py-3">
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold",
                    p.className,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", p.dot)} aria-hidden="true" />
                  {p.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-5">
                    {row.label}: {row.value}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">
                    {row.detail}
                    {row.source ? <span className="text-ink-soft"> · {row.source}</span> : null}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="absolute -top-5 -right-4 hidden items-start gap-2 rounded-xl border border-line bg-white px-3 py-2 shadow-pop md:flex">
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden="true" />
        <span className="text-xs leading-4">
          <span className="block font-semibold text-ink">Every value has a quote</span>
          <span className="block text-ink-muted">and a link to the page it came from</span>
        </span>
      </div>
    </div>
  );
}
