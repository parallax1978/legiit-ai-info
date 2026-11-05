"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { RunLogEntry } from "@/lib/db/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const SHOWN = 20;

function timeOf(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The last 20 log lines, monospace, warnings and errors colored. */
export function RunLog({ log }: { log: RunLogEntry[] }) {
  const [open, setOpen] = useState(false);
  const entries = log.slice(-SHOWN);
  if (!entries.length) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        {open ? "Hide the log" : `Show the log (${log.length})`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-surface-sunken p-3 font-mono text-xs leading-5 text-ink-muted">
          {entries.map((entry, i) => (
            <li
              key={`${entry.at}-${i}`}
              className={cn(
                "flex gap-2 break-words",
                entry.level === "warn" && "text-warn",
                entry.level === "error" && "text-bad",
              )}
            >
              <span className="shrink-0 tabular-nums text-ink-soft">{timeOf(entry.at)}</span>
              <span className="min-w-0 break-words">{entry.message}</span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
