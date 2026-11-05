"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import type { AddressValue } from "@/lib/facts/types";
import type { FieldType } from "@/templates/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ADDRESS_KEYS,
  ADDRESS_LABELS,
  addressForLine,
  addressFromParts,
  isAddressValue,
  isEmptyValue,
  isOneLineAddress,
  lineForParts,
} from "@/lib/projects/view";
import { EditorActions, type EditorProps } from "./editor-actions";
import { ListEditor } from "./list-editor";

const PLACEHOLDERS: Partial<Record<FieldType, string>> = {
  url: "https://",
  email: "name@example.com",
  phone: "+1 604 555 0199",
  date: "2018, or 2018-02-07",
  number: "45",
};

const INPUT_MODE: Partial<Record<FieldType, "url" | "email" | "tel" | "decimal">> = {
  url: "url",
  email: "email",
  phone: "tel",
  number: "decimal",
};

/*
  The inline editor for one field: an input or textarea by type, five inputs
  for an address, and the repeating row editor for lists.
*/
export function FieldEditor(props: EditorProps) {
  if (props.field.type === "list") return <ListEditor {...props} />;
  if (props.field.type === "address") return <AddressEditor {...props} />;
  return <ScalarEditor {...props} />;
}

function ScalarEditor({ field, initial, busy, onSave, onCancel, autoFocus }: EditorProps) {
  const [text, setText] = useState(typeof initial === "string" ? initial : "");
  const empty = text.trim().length === 0;
  const long = field.type === "long_text";

  const submit = async () => {
    if (empty || busy) return;
    await onSave(text.trim());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && long && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const id = `edit-${field.id}`;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor={id} className="sr-only">
        {field.label}
      </Label>
      {long ? (
        <Textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={4}
          autoFocus={autoFocus}
          disabled={busy}
          placeholder={field.example}
          className="bg-white"
        />
      ) : (
        <Input
          id={id}
          type={field.type === "phone" ? "tel" : "text"}
          inputMode={INPUT_MODE[field.type]}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          disabled={busy}
          placeholder={field.example ?? PLACEHOLDERS[field.type]}
          className="bg-white"
        />
      )}
      <EditorActions
        busy={busy}
        disabled={empty}
        onCancel={onCancel}
        hint={long ? "Ctrl+Enter saves" : field.type === "url" ? "Paste the full address, starting with https://" : null}
      />
    </form>
  );
}

/*
  An address is edited in parts, or as one line. One that exists only as a
  line of text (how the merge stores an address a page gave as one string)
  opens as that line, so the current value is there to correct and nothing
  typed into one part replaces the rest.
*/
function AddressEditor({ field, initial, busy, onSave, onCancel, autoFocus }: EditorProps) {
  const keys = useMemo(() => (field.addressKeys?.length ? field.addressKeys : [...ADDRESS_KEYS]), [field.addressKeys]);
  const start = isAddressValue(initial) ? initial : null;
  const [oneLine, setOneLine] = useState(() => start !== null && isOneLineAddress(start, keys));
  const [line, setLine] = useState(() => start?.text?.trim() ?? "");
  const [parts, setParts] = useState<Record<string, string>>(() => {
    const base: Record<string, string | undefined> = start ? { ...start } : {};
    return Object.fromEntries(keys.map((k) => [k, base[k] ?? ""]));
  });
  // The parts as they stood when the line was last current, to tell whether a part was edited since.
  const [partsAtLine, setPartsAtLine] = useState(parts);

  const fromParts = useMemo(() => addressFromParts(parts, keys), [parts, keys]);
  const value: AddressValue = oneLine ? addressForLine(line, parts, keys) : fromParts;
  const empty = isEmptyValue(value);

  const switchMode = () => {
    if (oneLine) {
      // Moving to empty parts: start the street with the line so none of it is lost.
      const street = keys.includes("streetAddress") ? "streetAddress" : keys[0];
      let next = parts;
      if (street && line.trim() && !keys.some((k) => parts[k]?.trim())) {
        next = { ...parts, [street]: line.trim() };
        setParts(next);
      }
      setPartsAtLine(next);
    } else {
      // Moving to one line: keep the line, unless a part was edited since it was last current.
      setLine(lineForParts(line, partsAtLine, parts, keys));
    }
    setOneLine(!oneLine);
  };

  const lineId = `edit-${field.id}-line`;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (empty || busy) return;
        void onSave(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onCancel) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      {oneLine ? (
        <div>
          <Label htmlFor={lineId} className="mb-1 text-xs text-ink-muted">
            Address
          </Label>
          <Input
            id={lineId}
            value={line}
            onChange={(e) => setLine(e.target.value)}
            autoFocus={autoFocus}
            disabled={busy}
            className="bg-white"
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {keys.map((k, i) => {
            const id = `edit-${field.id}-${k}`;
            return (
              <div key={k} className={k === "streetAddress" ? "sm:col-span-2" : undefined}>
                <Label htmlFor={id} className="mb-1 text-xs text-ink-muted">
                  {ADDRESS_LABELS[k] ?? k}
                </Label>
                <Input
                  id={id}
                  value={parts[k] ?? ""}
                  onChange={(e) => setParts((p) => ({ ...p, [k]: e.target.value }))}
                  autoFocus={autoFocus && i === 0}
                  disabled={busy}
                  className="bg-white"
                />
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={switchMode}
        disabled={busy}
        className="text-xs font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50"
      >
        {oneLine ? "Enter it in parts" : "Enter it as one line"}
      </button>
      <EditorActions busy={busy} disabled={empty} onCancel={onCancel} />
    </form>
  );
}
