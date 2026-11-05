"use client";

import { useState } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import type { Candidate } from "@/lib/facts/types";
import type { TemplateField } from "@/templates/types";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { candidateItemSummary, formatValue, itemLabel, type PageSummary } from "@/lib/projects/view";
import { cn } from "@/lib/utils";
import { EvidenceList } from "./evidence-list";

const OTHER = "other";

/*
  The candidates of a conflict as a radio list, each with its value and its
  evidence, a "Use this" button, and a "Type a different value" option that
  opens the inline editor. Used for whole-field conflicts and, in compact
  form, for one item of a list.
*/
export function ConflictPicker({
  field,
  candidates,
  pages,
  on,
  busy,
  onPick,
  onTypeOwn,
  compact,
}: {
  field: TemplateField;
  candidates: Candidate[];
  pages: PageSummary[];
  /** For item conflicts: the item keys that disagree. */
  on?: string[];
  busy?: boolean;
  onPick: (index: number) => Promise<boolean> | boolean;
  onTypeOwn?: () => void;
  compact?: boolean;
}) {
  const [selected, setSelected] = useState("");
  const isOther = selected === OTHER;
  const index = Number(selected);
  const canAct = selected !== "" && (isOther || Number.isInteger(index));

  const act = async () => {
    if (!canAct || busy) return;
    if (isOther) {
      onTypeOwn?.();
      return;
    }
    await onPick(index);
  };

  const label = (c: Candidate) =>
    on?.length ? candidateItemSummary(field, c.value, on) : formatValue(field, c.value) || "(empty)";

  const heading = on?.length
    ? `Pages disagree on ${on.map((k) => itemLabel(field, k).toLowerCase()).join(" and ")}. Pick the right one.`
    : `The site gives ${candidates.length} different values. Pick the right one.`;

  return (
    <div className={cn("rounded-lg border border-warn/30 bg-warn-soft/40 p-3", compact ? "mt-2" : "mt-3")}>
      <p className="flex items-start gap-1.5 text-sm font-medium text-warn">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {heading}
      </p>
      <RadioGroup
        value={selected}
        onValueChange={(v) => setSelected(String(v))}
        className="mt-3 gap-2"
        aria-label={`Values found for ${field.label}`}
        disabled={busy}
      >
        {candidates.map((c, i) => {
          const value = String(i);
          const checked = selected === value;
          return (
            <label
              key={i}
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border bg-white p-3 transition-colors",
                checked ? "border-brand ring-1 ring-brand" : "border-line hover:border-line-strong",
              )}
            >
              <RadioGroupItem value={value} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-ink">{label(c)}</p>
                <EvidenceList evidence={c.evidence} pages={pages} className="mt-2" />
              </div>
            </label>
          );
        })}
        {onTypeOwn ? (
          <label
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border bg-white p-3 transition-colors",
              isOther ? "border-brand ring-1 ring-brand" : "border-line hover:border-line-strong",
            )}
          >
            <RadioGroupItem value={OTHER} />
            <span className="text-sm text-ink">Type a different value</span>
          </label>
        ) : null}
      </RadioGroup>
      <div className="mt-3">
        <Button type="button" variant="primary" size="sm" disabled={!canAct || busy} onClick={() => void act()}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          {isOther ? "Type a different value" : "Use this"}
        </Button>
      </div>
    </div>
  );
}
