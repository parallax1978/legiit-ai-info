"use client";

import { LoaderCircle } from "lucide-react";
import type { FactValue } from "@/lib/facts/types";
import type { TemplateField } from "@/templates/types";
import { Button } from "@/components/ui/button";

/** What every inline editor receives. */
export interface EditorProps {
  field: TemplateField;
  initial: FactValue;
  busy?: boolean;
  /** Resolves true when the save went through; the editor then closes. */
  onSave: (value: FactValue) => Promise<boolean> | boolean;
  /** Absent for missing fields, whose editor is always open. */
  onCancel?: () => void;
  autoFocus?: boolean;
}

/** Save, optional Cancel, and a hint line. */
export function EditorActions({
  busy,
  disabled,
  onCancel,
  hint,
  saveLabel = "Save",
}: {
  busy?: boolean;
  disabled?: boolean;
  onCancel?: () => void;
  hint?: string | null;
  saveLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="primary" size="sm" disabled={disabled || busy}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
        {saveLabel}
      </Button>
      {onCancel ? (
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      ) : null}
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
  );
}
