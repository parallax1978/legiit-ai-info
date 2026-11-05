"use client";

import { Fragment } from "react";
import type { FactValue, ListItem, ListItemConflict } from "@/lib/facts/types";
import type { ListItemShape, TemplateField } from "@/templates/types";
import {
  addressLines,
  conflictForItem,
  dedupeKeyOf,
  isAddressValue,
  isEmptyValue,
  isListValue,
  listLayout,
  type PageSummary,
} from "@/lib/projects/view";
import { ConflictPicker } from "./conflict-picker";

export interface ValueDisplayProps {
  field: TemplateField;
  value: FactValue;
  itemConflicts?: ListItemConflict[];
  pages: PageSummary[];
  busy?: boolean;
  onPickItem?: (conflictKey: string, index: number) => Promise<boolean> | boolean;
  onTypeOwn?: () => void;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="break-all text-brand underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

function Cell({ shape, value }: { shape: ListItemShape; value: string | undefined }) {
  const v = value?.trim();
  if (!v) return null;
  if (shape.type === "url") return <ExternalLink href={v}>{v}</ExternalLink>;
  if (shape.type === "long_text") return <span className="whitespace-pre-line">{v}</span>;
  return <>{v}</>;
}

function ItemConflict({
  field,
  conflict,
  pages,
  busy,
  onPickItem,
  onTypeOwn,
}: {
  field: TemplateField;
  conflict: ListItemConflict;
  pages: PageSummary[];
  busy?: boolean;
  onPickItem?: ValueDisplayProps["onPickItem"];
  onTypeOwn?: () => void;
}) {
  if (!onPickItem) return null;
  return (
    <ConflictPicker
      compact
      field={field}
      candidates={conflict.candidates}
      pages={pages}
      on={conflict.on}
      busy={busy}
      onPick={(index) => onPickItem(conflict.key, index)}
      onTypeOwn={onTypeOwn}
    />
  );
}

function ListValue({ field, items, itemConflicts, pages, busy, onPickItem, onTypeOwn }: ValueDisplayProps & { items: ListItem[] }) {
  const shape = field.itemShape?.length ? field.itemShape : Object.keys(items[0] ?? {}).map((key) => ({ key, label: key, type: "text" as const }));
  const primary = dedupeKeyOf(field) || shape[0]?.key;
  const matched = new Set<ListItemConflict>();
  const rows = items.map((item) => {
    const conflict = conflictForItem(field, item, itemConflicts);
    if (conflict) matched.add(conflict);
    return { item, conflict };
  });
  const unmatched = (itemConflicts ?? []).filter((c) => !matched.has(c));

  const conflictProps = { field, pages, busy, onPickItem, onTypeOwn };

  const body =
    listLayout(field) === "table" ? (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {shape.map((s) => (
                <th key={s.key} scope="col" className="pb-1.5 pr-4 text-left text-xs font-medium text-ink-muted">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, conflict }, i) => (
              <Fragment key={i}>
                <tr className="border-t border-line align-top">
                  {shape.map((s) => (
                    <td key={s.key} className="py-1.5 pr-4 break-words text-ink">
                      <Cell shape={s} value={item[s.key]} />
                    </td>
                  ))}
                </tr>
                {conflict ? (
                  <tr>
                    <td colSpan={shape.length} className="pb-2">
                      <ItemConflict conflict={conflict} {...conflictProps} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <ol className="space-y-2">
        {rows.map(({ item, conflict }, i) => (
          <li key={i} className="rounded-lg border border-line p-3">
            <p className="text-sm font-semibold text-ink">
              {item[primary]?.trim() || <span className="font-normal text-ink-soft">Unnamed</span>}
            </p>
            <dl className="mt-1.5 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]">
              {shape
                .filter((s) => s.key !== primary && item[s.key]?.trim())
                .map((s) => (
                  <Fragment key={s.key}>
                    <dt className="text-ink-muted">{s.label}</dt>
                    <dd className="min-w-0 break-words text-ink">
                      <Cell shape={s} value={item[s.key]} />
                    </dd>
                  </Fragment>
                ))}
            </dl>
            {conflict ? <ItemConflict conflict={conflict} {...conflictProps} /> : null}
          </li>
        ))}
      </ol>
    );

  return (
    <div>
      {body}
      {unmatched.map((c) => (
        <div key={c.key} className="mt-2">
          <p className="text-xs text-ink-muted">Also found for {c.key}</p>
          <ItemConflict conflict={c} {...conflictProps} />
        </div>
      ))}
    </div>
  );
}

/** The field's value rendered by type: text, paragraphs, links, address lines, or a list. */
export function ValueDisplay(props: ValueDisplayProps) {
  const { field, value } = props;
  if (isEmptyValue(value)) return <p className="text-sm text-ink-soft">Nothing recorded</p>;

  if (isListValue(value)) return <ListValue {...props} items={value} />;

  if (isAddressValue(value)) {
    return (
      <address className="text-[15px] not-italic leading-6 text-ink">
        {addressLines(value).map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </address>
    );
  }

  const text = String(value).trim();
  switch (field.type) {
    case "long_text":
      return (
        <div className="space-y-2 text-[15px] leading-6 text-ink">
          {text
            .split(/\n{2,}|\r\n{2,}/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p, i) => (
              <p key={i} className="whitespace-pre-line">
                {p}
              </p>
            ))}
        </div>
      );
    case "url":
      return (
        <p className="text-[15px] leading-6">
          <ExternalLink href={text}>{text}</ExternalLink>
        </p>
      );
    case "email":
      return (
        <p className="text-[15px] leading-6">
          <a href={`mailto:${text}`} className="break-all text-brand underline-offset-2 hover:underline">
            {text}
          </a>
        </p>
      );
    case "phone":
      return (
        <p className="text-[15px] leading-6">
          <a href={`tel:${text.replace(/[^\d+]/g, "")}`} className="text-brand underline-offset-2 hover:underline">
            {text}
          </a>
        </p>
      );
    default:
      return <p className="break-words text-[15px] leading-6 text-ink">{text}</p>;
  }
}
