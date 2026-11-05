"use client";

import { useState } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { hostPath, prettyJsonLd, type SchemaGroup } from "@/lib/projects/view";
import { cn } from "@/lib/utils";
import { Pill } from "./status-pill";

/** Every JSON-LD block found on the site, grouped by page, with parse errors shown. */
export function ExistingSchemaPanel({ groups }: { groups: SchemaGroup[] }) {
  const [open, setOpen] = useState(false);
  const total = groups.reduce((n, g) => n + g.blocks.length, 0);
  const broken = groups.reduce((n, g) => n + g.blocks.filter((b) => b.error).length, 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-card border border-line bg-white shadow-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="min-w-0">
          <span className="block text-base font-semibold text-ink">Schema already on the site</span>
          <span className="block text-xs text-ink-muted">
            {total
              ? `${total} JSON-LD ${total === 1 ? "block" : "blocks"} on ${groups.length} ${groups.length === 1 ? "page" : "pages"}`
              : "No JSON-LD found"}
            {broken ? `, ${broken} with a parse error` : ""}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-muted transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-5 border-t border-line px-5 py-4">
          <p className="text-sm text-ink-muted">
            Where this schema disagrees with the fact sheet, the conflict is shown on the field itself. The page
            we generate replaces these blocks with one Organization and one AboutPage block built from the fact sheet.
          </p>
          {groups.length ? (
            groups.map((g) => (
              <section key={g.url}>
                <h3 className="text-sm font-semibold text-ink">
                  <a href={g.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {g.title?.trim() || hostPath(g.url)}
                  </a>
                  <span className="ml-2 text-xs font-normal text-ink-muted">{hostPath(g.url)}</span>
                </h3>
                <div className="mt-2 space-y-3">
                  {g.blocks.map((block, i) => (
                    <div key={i} className="rounded-lg border border-line">
                      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
                        {block.types?.length ? (
                          block.types.map((t) => (
                            <Pill key={t} tone="brand">
                              {t}
                            </Pill>
                          ))
                        ) : (
                          <Pill tone="muted">No @type</Pill>
                        )}
                        {block.error ? (
                          <span className="inline-flex items-center gap-1 text-xs text-bad">
                            <CircleAlert className="size-3.5" aria-hidden="true" />
                            Did not parse: {block.error}
                          </span>
                        ) : null}
                      </div>
                      <pre className="max-h-72 overflow-auto bg-surface-sunken p-3 font-mono text-xs leading-5 text-ink">
                        {prettyJsonLd(block)}
                      </pre>
                    </div>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <p className="text-sm text-ink-muted">The pages we read carry no JSON-LD. The generated page will add it.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
