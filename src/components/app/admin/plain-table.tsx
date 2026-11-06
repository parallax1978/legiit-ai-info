import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PlainTableRow {
  key: string;
  cells: ReactNode[];
}

/*
  The admin tables: a white card with a line border, an eyebrow header row,
  rows divided by lines. Number columns are right-aligned through `align`.
*/
export function PlainTable({
  caption,
  columns,
  rows,
  align = [],
  empty = "Nothing yet.",
  className,
}: {
  caption?: string;
  columns: string[];
  rows: PlainTableRow[];
  /** Per column: "right" for numbers. */
  align?: ("left" | "right")[];
  empty?: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-card border border-line bg-white shadow-card", className)}>
      <table className="w-full text-sm">
        {caption ? (
          <caption className="px-4 pt-4 pb-2 text-left text-base font-semibold text-ink">{caption}</caption>
        ) : null}
        <thead>
          <tr className="border-b border-line">
            {columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cn("eyebrow px-4 py-2.5 whitespace-nowrap text-ink-soft", align[i] === "right" ? "text-right" : "text-left")}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-ink-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell, i) => (
                  <td
                    key={columns[i] ?? i}
                    className={cn("px-4 py-2.5 align-top text-ink", align[i] === "right" ? "text-right tabular-nums" : "text-left")}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
