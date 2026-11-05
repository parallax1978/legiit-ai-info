"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { FactSheetRow } from "@/lib/db/types";
import type { FactField, FactSheetData, FactSheetStats, FactValue } from "@/lib/facts/types";
import type { TemplateSpec } from "@/templates/types";
import { errorMessage, patchFactSheet, type FactSheetEdit } from "@/lib/projects/api";
import {
  companyNameOf,
  normalizeFields,
  sectionCounts,
  statusCounts,
  type PageSummary,
} from "@/lib/projects/view";
import { FieldCard, type FieldActions } from "./field-card";
import { ReviewSummary } from "./review-summary";
import { SectionNav } from "./section-nav";

function hasStats(stats: FactSheetRow["stats"]): stats is FactSheetStats {
  return typeof stats === "object" && stats !== null && typeof (stats as FactSheetStats).found === "number";
}

/*
  The review screen: section navigation with counts on the left, one group
  per template section on the right, a FieldCard per field. Field state lives
  here and every edit goes through PATCH /api/fact-sheets/[id]; the response
  replaces the field and the stats.
*/
export function FactSheetReview({
  factSheet,
  spec,
  pages,
}: {
  factSheet: FactSheetRow;
  spec: TemplateSpec;
  pages: PageSummary[];
}) {
  const [fields, setFields] = useState<Record<string, FactField>>(() => normalizeFields(spec, factSheet.data));
  const [stats, setStats] = useState<FactSheetStats | null>(hasStats(factSheet.stats) ? factSheet.stats : null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  // The page keys this component by fact sheet id, so a new version after a
  // re-run mounts a fresh copy with fresh state.

  const data = useMemo<FactSheetData>(() => ({ templateId: spec.id, fields }), [spec.id, fields]);
  const counts = useMemo(() => statusCounts(spec, data), [spec, data]);
  const sections = useMemo(() => sectionCounts(spec, data), [spec, data]);
  const companyName = useMemo(() => companyNameOf(fields), [fields]);

  const apply = useCallback(
    async (fieldId: string, edit: FactSheetEdit): Promise<boolean> => {
      setBusy((b) => ({ ...b, [fieldId]: true }));
      try {
        const result = await patchFactSheet(factSheet.id, edit);
        setFields((prev) => ({ ...prev, [fieldId]: result.field }));
        setStats(result.stats);
        return true;
      } catch (e) {
        toast.error(errorMessage(e));
        return false;
      } finally {
        setBusy((b) => ({ ...b, [fieldId]: false }));
      }
    },
    [factSheet.id],
  );

  const actions = useMemo<FieldActions>(
    () => ({
      save: (fieldId: string, value: FactValue) => apply(fieldId, { fieldId, value }),
      pickCandidate: (fieldId: string, index: number) => apply(fieldId, { fieldId, pickCandidate: index }),
      pickItemCandidate: (fieldId: string, conflictKey: string, index: number) =>
        apply(fieldId, { fieldId, pickItemCandidate: { conflictKey, index } }),
      clear: (fieldId: string) => apply(fieldId, { fieldId, clear: true }),
    }),
    [apply],
  );

  // Track which section is in view for the nav.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const elements = sections
      .map((s) => document.getElementById(`section-${s.id}`))
      .filter((el): el is HTMLElement => el !== null);
    if (!elements.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0]?.target.id;
        if (first) setActiveId(first.replace(/^section-/, ""));
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  const select = (id: string) => {
    setActiveId(id);
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="lg:flex lg:items-start lg:gap-8">
      <aside className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:w-64 lg:shrink-0 lg:overflow-y-auto">
        <ReviewSummary counts={counts} stats={stats} />
        <SectionNav sections={sections} activeId={activeId} onSelect={select} />
      </aside>

      <div className="mt-6 min-w-0 flex-1 space-y-10 lg:mt-0">
        {sections.map((section) => {
          const specFields = spec.fields.filter((f) => f.section === section.id);
          if (!specFields.length) return null;
          return (
            <section key={section.id} id={`section-${section.id}`} className="scroll-mt-24">
              <header className="mb-4">
                <h2 className="text-xl">{section.title}</h2>
                <p className="mt-1 text-sm text-ink-muted">{section.description}</p>
              </header>
              <div className="space-y-4">
                {specFields.map((field) => (
                  <FieldCard
                    key={field.id}
                    field={field}
                    data={fields[field.id]}
                    pages={pages}
                    actions={actions}
                    busy={Boolean(busy[field.id])}
                    companyName={companyName}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
