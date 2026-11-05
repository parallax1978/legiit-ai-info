"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import type { AddressValue } from "@/lib/facts/types";
import type { FieldType } from "@/templates/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ADDRESS_KEYS, ADDRESS_LABELS, formatAddress, isAddressValue, isEmptyValue } from "@/lib/projects/view";
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

function AddressEditor({ field, initial, busy, onSave, onCancel, autoFocus }: EditorProps) {
  const keys = useMemo(() => (field.addressKeys?.length ? field.addressKeys : [...ADDRESS_KEYS]), [field.addressKeys]);
  const [parts, setParts] = useState<Record<string, string>>(() => {
    const base: Record<string, string | undefined> = isAddressValue(initial) ? { ...initial } : {};
    return Object.fromEntries(keys.map((k) => [k, base[k] ?? ""]));
  });

  const value = useMemo<AddressValue>(() => {
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = parts[k]?.trim();
      if (v) out[k] = v;
    }
    const address = out as AddressValue;
    const text = formatAddress(address);
    if (text) address.text = text;
    return address;
  }, [parts, keys]);

  const empty = isEmptyValue(value);

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
      <EditorActions busy={busy} disabled={empty} onCancel={onCancel} />
    </form>
  );
}
