"use client";

import type { SectionCounts } from "@/lib/projects/view";
import { cn } from "@/lib/utils";

function Count({ tone, n }: { tone: "good" | "warn" | "bad"; n: number }) {
  const dot = tone === "good" ? "bg-good" : tone === "warn" ? "bg-warn" : "bg-bad";
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", n === 0 && "opacity-40")}>
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden="true" />
      {n}
    </span>
  );
}

/*
  The template sections in order with counts per status. A vertical list on
  desktop, a horizontal row of pills on mobile. Clicking scrolls to the section.
*/
export function SectionNav({
  sections,
  activeId,
  onSelect,
}: {
  sections: SectionCounts[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Fact sheet sections">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:hidden lg:px-0">
        {sections.map((s) => {
          const open = s.counts.conflict + s.counts.missing;
          const active = s.id === activeId;
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition-colors",
                  active ? "bg-brand text-white ring-brand" : "bg-white text-ink ring-line hover:bg-surface-alt",
                )}
              >
                {s.title}
                {open > 0 ? (
                  <span
                    className={cn(
                      "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums",
                      active ? "bg-white/20 text-white" : s.counts.missing > 0 ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn",
                    )}
                  >
                    {open}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <ul className="hidden space-y-0.5 lg:block">
        {sections.map((s) => {
          const active = s.id === activeId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  active ? "bg-brand-faint font-medium text-brand" : "text-ink-muted hover:bg-surface-alt hover:text-ink",
                )}
              >
                <span className="truncate">{s.title}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <Count tone="good" n={s.counts.found + s.counts.userProvided} />
                  <Count tone="warn" n={s.counts.conflict} />
                  <Count tone="bad" n={s.counts.missing} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
