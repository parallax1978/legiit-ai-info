"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Evidence, EvidenceSource } from "@/lib/facts/types";
import { sourceLabel, sourceTag, type PageSummary } from "@/lib/projects/view";
import { cn } from "@/lib/utils";

const CLAMP = 260;

export function SourceTag({ source }: { source: EvidenceSource }) {
  return (
    <span className="inline-flex h-4 items-center rounded border border-line px-1 text-[10px] font-medium uppercase tracking-wide text-ink-soft">
      {sourceTag(source)}
    </span>
  );
}

/** Page title or host path as a link to the page; "You" for user-supplied evidence. */
export function SourceLink({ url, pages, className }: { url: string; pages: PageSummary[]; className?: string }) {
  const label = sourceLabel(url, pages);
  if (!url) return <span className={className}>{label}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex min-w-0 items-center gap-0.5 underline-offset-2 hover:text-ink hover:underline", className)}
    >
      <span className="truncate">{label}</span>
      <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

function EvidenceItem({ evidence, pages }: { evidence: Evidence; pages: PageSummary[] }) {
  const [open, setOpen] = useState(false);
  const long = evidence.quote.length > CLAMP;
  const quote = long && !open ? `${evidence.quote.slice(0, CLAMP).trimEnd()}...` : evidence.quote;
  return (
    <li className="border-l-2 border-line pl-3 text-sm text-ink-muted">
      <p className="break-words whitespace-pre-line">
        {quote}
        {long ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-1 text-xs font-medium text-brand hover:underline"
          >
            {open ? "Less" : "More"}
          </button>
        ) : null}
      </p>
      <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
        <SourceTag source={evidence.source} />
        <SourceLink url={evidence.url} pages={pages} className="min-w-0" />
      </p>
    </li>
  );
}

/** Each quote with where it came from. */
export function EvidenceList({
  evidence,
  pages,
  className,
}: {
  evidence: Evidence[];
  pages: PageSummary[];
  className?: string;
}) {
  if (!evidence.length) return null;
  return (
    <ul className={cn("space-y-2", className)}>
      {evidence.map((e, i) => (
        <EvidenceItem key={`${e.url}-${i}`} evidence={e} pages={pages} />
      ))}
    </ul>
  );
}
