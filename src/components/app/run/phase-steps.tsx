import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PHASE_STEPS, phaseIndex } from "@/lib/projects/view";
import type { RunPhaseT } from "@/lib/db/types";

/*
  The four-step indicator: Discover, Read, Extract, Merge. Finished steps get
  a brand check, the current step is brand, the rest are muted.
*/
export function PhaseSteps({ phase, failed }: { phase: RunPhaseT; failed?: boolean }) {
  const current = phaseIndex(phase);
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Scan steps">
      {PHASE_STEPS.map((step, i) => {
        const done = current > i;
        const active = current === i && !failed;
        return (
          <li key={step.id} className="min-w-0">
            <div
              className={cn(
                "h-1 rounded-full",
                done || active ? "bg-brand" : "bg-line",
                active && "animate-pulse",
              )}
            />
            <div
              className={cn(
                "mt-2 flex items-center gap-1 text-xs font-medium",
                done || active ? "text-brand" : "text-ink-soft",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? (
                <Check className="size-3.5 stroke-[3]" aria-hidden="true" />
              ) : (
                <span
                  className={cn(
                    "inline-block size-1.5 rounded-full",
                    active ? "bg-brand" : "bg-line-strong",
                  )}
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{step.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
