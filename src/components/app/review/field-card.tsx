"use client";

import { useState } from "react";
import { Info, Pencil } from "lucide-react";
import type { FactField, FactValue } from "@/lib/facts/types";
import type { TemplateField } from "@/templates/types";
import { Button } from "@/components/ui/button";
import { fillCompany, type PageSummary } from "@/lib/projects/view";
import { cn } from "@/lib/utils";
import { ConflictPicker } from "./conflict-picker";
import { EvidenceList } from "./evidence-list";
import { FieldEditor } from "./field-editor";
import { Pill, StatusPill } from "./status-pill";
import { ValueDisplay } from "./value-display";

export interface FieldActions {
  save: (fieldId: string, value: FactValue) => Promise<boolean>;
  pickCandidate: (fieldId: string, index: number) => Promise<boolean>;
  pickItemCandidate: (fieldId: string, conflictKey: string, index: number) => Promise<boolean>;
  clear: (fieldId: string) => Promise<boolean>;
}

/*
  One field: label, status, the value with its evidence, and the right
  control for its status. Found and user-provided values can be edited,
  conflicts are picked from, missing fields ask their question.
*/
export function FieldCard({
  field,
  data,
  pages,
  actions,
  busy,
  companyName,
}: {
  field: TemplateField;
  data: FactField;
  pages: PageSummary[];
  actions: FieldActions;
  busy: boolean;
  companyName: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const status = data.status;
  const requiredMissing = field.required && status === "missing";
  const editable = status === "found" || status === "user_provided";

  const save = async (value: FactValue) => {
    const ok = await actions.save(field.id, value);
    if (ok) setEditing(false);
    return ok;
  };

  const openEditor = () => setEditing(true);

  return (
    <article
      id={`field-${field.id}`}
      className={cn(
        "scroll-mt-24 rounded-card border border-line bg-white p-4 shadow-card sm:p-5",
        requiredMissing && "border-l-4 border-l-bad/40",
      )}
      aria-busy={busy || undefined}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-snug text-ink">
            {field.label}
            {field.required ? (
              <span className="ml-1 text-bad" title="Required">
                *
              </span>
            ) : null}
          </h3>
          {data.derived ? (
            <Pill tone="warn" className="mt-1" title="The tool built this value rather than finding it">
              constructed, confirm it
            </Pill>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={status} />
          {editable && !editing ? (
            <Button variant="ghost" size="xs" onClick={openEditor} disabled={busy}>
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </Button>
          ) : null}
        </div>
      </header>

      {status === "user_provided" ? (
        <p className="mt-2 text-xs text-ink-muted">
          You provided this.
          {data.crawled ? (
            <>
              {" "}
              <button
                type="button"
                onClick={() => void actions.clear(field.id)}
                disabled={busy}
                className="font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50"
              >
                Restore what the scan found
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {data.note ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{data.note}</span>
        </p>
      ) : null}

      <div className="mt-3">
        {editing ? (
          <FieldEditor field={field} initial={data.value} busy={busy} onSave={save} onCancel={() => setEditing(false)} autoFocus />
        ) : status === "missing" ? (
          <>
            <p className="text-sm text-ink">{fillCompany(field.question, companyName)}</p>
            <div className="mt-3">
              <FieldEditor field={field} initial={null} busy={busy} onSave={save} />
            </div>
          </>
        ) : status === "conflict" ? (
          <ConflictPicker
            field={field}
            candidates={data.candidates ?? []}
            pages={pages}
            busy={busy}
            onPick={(index) => actions.pickCandidate(field.id, index)}
            onTypeOwn={openEditor}
          />
        ) : (
          <ValueDisplay
            field={field}
            value={data.value}
            itemConflicts={data.itemConflicts}
            pages={pages}
            busy={busy}
            onPickItem={(key, index) => actions.pickItemCandidate(field.id, key, index)}
            onTypeOwn={openEditor}
          />
        )}
      </div>

      {!editing && status !== "conflict" && status !== "missing" && data.evidence.length ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="eyebrow text-ink-soft">Evidence</p>
          <EvidenceList evidence={data.evidence} pages={pages} className="mt-2" />
        </div>
      ) : null}
    </article>
  );
}
