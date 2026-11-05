import { CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  An excerpt of the Darcy Bailey & Associates Counselling fact sheet from
  examples/fixtures/darcy-bailey.factsheet.json: real values, real quotes.
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
    label: "Phone",
    value: "604-533-9163",
    detail: "“Call 604-533-9163”",
    source: "about page",
  },
  {
    status: "found",
    label: "Fees",
    value: "$170 per 50-minute session",
    detail: "“Individual counselling is $170 per 50-minute session”",
    source: "rates page",
  },
  {
    status: "conflict",
    label: "Years in business",
    value: "17+ on the About page, 19+ on the home page",
    detail: "Pick one, or type the right number.",
  },
  {
    status: "missing",
    label: "Founder's book title",
    value: "not on the site",
    detail: "What is the title of Darcy's book?",
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
        <p className="mt-1 text-lg font-bold tracking-tight">Darcy Bailey &amp; Associates Counselling</p>
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
