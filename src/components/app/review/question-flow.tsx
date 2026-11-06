"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import type { FactField, FactValue } from "@/lib/facts/types";
import type { TemplateField, TemplateSpec } from "@/templates/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { questionOrder } from "@/lib/facts/manual";
import { fillCompany } from "@/lib/projects/view";
import { FieldEditor } from "./field-editor";
import { Pill } from "./status-pill";

export interface QuestionFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spec: TemplateSpec;
  fields: Record<string, FactField>;
  companyName: string | null;
  /** Fields with a save in flight, by field id. */
  busy: Record<string, boolean>;
  /** The review's save path; resolves true once the value is stored. */
  onSave: (fieldId: string, value: FactValue) => Promise<boolean>;
}

/*
  "Fill the gaps": a dialog that asks the missing fields one at a time,
  required ones first, with the editor the field cards use. Every save goes
  through the review's own edit path, so the cards behind the dialog update
  as answers land. The list of questions is fixed when the dialog opens, so
  "3 of 11" does not shift under the person as they answer.
*/
export function QuestionFlow({ open, onOpenChange, ...rest }: QuestionFlowProps) {
  const body = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        // Start in the editor's first input, not on its first button (a list editor's "Remove item").
        initialFocus={() => body.current?.querySelector<HTMLElement>("input, textarea") ?? true}
      >
        <Steps {...rest} bodyRef={body} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

type StepsProps = Omit<QuestionFlowProps, "open" | "onOpenChange"> & {
  bodyRef: RefObject<HTMLDivElement | null>;
  onDone: () => void;
};

function Steps({ spec, fields, companyName, busy, onSave, bodyRef, onDone }: StepsProps) {
  // Fixed when this mounts, which is when the dialog opens: the popup is not rendered while closed.
  const [queue] = useState<TemplateField[]>(() => questionOrder(spec, fields));
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(0);
  const sectionTitles = useMemo(() => new Map(spec.sections.map((s) => [s.id, s.title])), [spec.sections]);

  const total = queue.length;
  const field = queue[index];
  if (!field) return <Finished total={total} answered={answered} onDone={onDone} />;

  const fieldBusy = Boolean(busy[field.id]);
  const save = async (value: FactValue) => {
    const ok = await onSave(field.id, value);
    if (ok) {
      setAnswered((n) => n + 1);
      setIndex((i) => i + 1);
    }
    return ok;
  };

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow text-brand">{sectionTitles.get(field.section) ?? "Fact sheet"}</p>
          {field.required ? <Pill tone="bad">Required</Pill> : null}
        </div>
        <DialogTitle className="text-lg">{field.label}</DialogTitle>
        <DialogDescription className="text-ink">{fillCompany(field.question, companyName)}</DialogDescription>
      </DialogHeader>
      <Progress value={Math.round((index / total) * 100)} aria-label="Gaps answered or skipped" />
      <div ref={bodyRef} className="max-h-[55vh] overflow-y-auto">
        <FieldEditor
          key={field.id}
          field={field}
          initial={fields[field.id]?.value ?? null}
          busy={fieldBusy}
          onSave={save}
          autoFocus
        />
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <p className="text-xs text-ink-muted tabular-nums">
          {index + 1} of {total}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIndex((i) => i + 1)} disabled={fieldBusy}>
          Skip
        </Button>
      </DialogFooter>
    </>
  );
}

function Finished({ total, answered, onDone }: { total: number; answered: number; onDone: () => void }) {
  const title = total === 0 ? "Nothing to fill" : "That was the last one";
  const text =
    total === 0
      ? "Every field has an answer."
      : answered < total
        ? `You answered ${answered} of ${total}. Open this again any time to fill the rest.`
        : total === 1
          ? "You answered it."
          : `You answered all ${total}.`;
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg">{title}</DialogTitle>
        <DialogDescription className="text-ink">{text}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="primary" size="sm" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
