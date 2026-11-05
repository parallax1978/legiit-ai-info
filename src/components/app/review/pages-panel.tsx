"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatNumber, hostPath, type PageDetail } from "@/lib/projects/view";
import { cn } from "@/lib/utils";
import { PageStatusPill } from "./status-pill";

/** Every page the run planned: rank, title or URL, status, characters, and a link. */
export function PagesPanel({ pages }: { pages: PageDetail[] }) {
  const [open, setOpen] = useState(false);
  const read = pages.filter((p) => p.status === "fetched" || p.status === "extracted").length;
  const failed = pages.filter((p) => p.status === "failed").length;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-card border border-line bg-white shadow-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="min-w-0">
          <span className="block text-base font-semibold text-ink">Pages we read</span>
          <span className="block text-xs text-ink-muted">
            {pages.length ? `${read} of ${pages.length} read` : "No pages recorded"}
            {failed ? `, ${failed} failed` : ""}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-muted transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="overflow-x-auto border-t border-line">
          {pages.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th scope="col" className="px-5 py-2 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Page
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Characters
                  </th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id} className="border-t border-line align-top">
                    <td className="px-5 py-2.5 tabular-nums text-ink-muted">{p.rank}</td>
                    <td className="min-w-56 px-2 py-2.5">
                      <div className="font-medium text-ink">{p.title?.trim() || hostPath(p.url)}</div>
                      <div className="truncate text-xs text-ink-muted" title={p.url}>
                        {hostPath(p.url)}
                        {p.reason ? ` (${p.reason})` : ""}
                        {p.httpStatus && p.httpStatus !== 200 ? ` HTTP ${p.httpStatus}` : ""}
                      </div>
                      {p.status === "failed" && p.error ? (
                        <div className="mt-0.5 text-xs text-bad">{p.error}</div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2.5">
                      <PageStatusPill status={p.status} />
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-ink-muted">
                      {p.textChars ? formatNumber(p.textChars) : ""}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-xs text-ink-muted hover:text-ink"
                      >
                        Open
                        <ArrowUpRight className="size-3" aria-hidden="true" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-4 text-sm text-ink-muted">This run recorded no pages.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
