"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ListItem } from "@/lib/facts/types";
import type { ListItemShape } from "@/templates/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isListValue } from "@/lib/projects/view";
import { cn } from "@/lib/utils";
import { EditorActions, type EditorProps } from "./editor-actions";

const FALLBACK_SHAPE: ListItemShape[] = [{ key: "value", label: "Value", type: "text", required: true }];

function emptyRow(shape: ListItemShape[]): ListItem {
  return Object.fromEntries(shape.map((s) => [s.key, ""]));
}

/** Trimmed values for the shape's keys; rows with nothing in them are dropped. */
function cleanRows(shape: ListItemShape[], rows: ListItem[]): ListItem[] {
  const out: ListItem[] = [];
  for (const row of rows) {
    const item: ListItem = {};
    for (const s of shape) {
      const v = row[s.key]?.trim();
      if (v) item[s.key] = v;
    }
    if (Object.keys(item).length) out.push(item);
  }
  return out;
}

/*
  A small repeating row editor built from the field's item shape, with add
  and remove. Rows left entirely empty are ignored; a row that has something
  in it needs every required key.
*/
export function ListEditor({ field, initial, busy, onSave, onCancel, autoFocus }: EditorProps) {
  const shape = useMemo(() => (field.itemShape?.length ? field.itemShape : FALLBACK_SHAPE), [field.itemShape]);
  const [rows, setRows] = useState<ListItem[]>(() =>
    isListValue(initial) && initial.length ? initial.map((item) => ({ ...emptyRow(shape), ...item })) : [emptyRow(shape)],
  );

  const required = useMemo(() => shape.filter((s) => s.required), [shape]);
  const cleaned = useMemo(() => cleanRows(shape, rows), [shape, rows]);
  const incomplete = cleaned.some((item) => required.some((s) => !item[s.key]));
  const canSave = cleaned.length > 0 && !incomplete;
  const twoColumns = shape.length > 1;

  const setCell = (index: number, key: string, value: string) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  const removeRow = (index: number) =>
    setRows((prev) => {
      if (prev.length === 1) return [emptyRow(shape)];
      return prev.filter((_, i) => i !== index);
    });

  const hint = incomplete
    ? `Each row needs ${required.map((s) => s.label.toLowerCase()).join(" and ")}`
    : cleaned.length === 0
      ? "Fill in at least one row"
      : null;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave || busy) return;
        void onSave(cleaned);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onCancel) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <ol className="space-y-2">
        {rows.map((row, index) => (
          <li key={index} className="rounded-lg border border-line bg-surface-alt/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-muted">Item {index + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removeRow(index)}
                disabled={busy}
                aria-label={`Remove item ${index + 1}`}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
            <div className={cn("mt-2 grid gap-3", twoColumns && "sm:grid-cols-2")}>
              {shape.map((s, j) => {
                const id = `edit-${field.id}-${index}-${s.key}`;
                const wide = s.type === "long_text";
                return (
                  <div key={s.key} className={cn(wide && twoColumns && "sm:col-span-2")}>
                    <Label htmlFor={id} className="mb-1 text-xs text-ink-muted">
                      {s.label}
                      {s.required ? (
                        <span className="text-bad" aria-hidden="true">
                          *
                        </span>
                      ) : null}
                    </Label>
                    {wide ? (
                      <Textarea
                        id={id}
                        value={row[s.key] ?? ""}
                        onChange={(e) => setCell(index, s.key, e.target.value)}
                        rows={3}
                        placeholder={s.hint}
                        disabled={busy}
                        autoFocus={autoFocus && index === 0 && j === 0}
                        className="min-h-14 bg-white"
                      />
                    ) : (
                      <Input
                        id={id}
                        value={row[s.key] ?? ""}
                        onChange={(e) => setCell(index, s.key, e.target.value)}
                        placeholder={s.hint}
                        inputMode={s.type === "url" ? "url" : s.type === "number" ? "decimal" : undefined}
                        disabled={busy}
                        autoFocus={autoFocus && index === 0 && j === 0}
                        className="bg-white"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <EditorActions busy={busy} disabled={!canSave} onCancel={onCancel} hint={hint} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((prev) => [...prev, emptyRow(shape)])}
          disabled={busy}
        >
          <Plus aria-hidden="true" />
          Add another
        </Button>
      </div>
    </form>
  );
}
