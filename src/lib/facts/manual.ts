/*
  Manual mode. A project the owner fills in by hand starts from a fact sheet
  with every field missing, and the question flow asks those fields one at a
  time. Pure: the route handler makes the sheet, the review screen orders the
  questions, and vitest runs both in node.
*/
import { recomputeStats } from "@/lib/extract/merge";
import type { TemplateField, TemplateSpec } from "@/templates/types";
import { emptyField, type FactField, type FactSheetData, type FactSheetStats } from "./types";

export interface EmptyFactSheet {
  data: FactSheetData;
  stats: FactSheetStats;
}

/** Every field of the spec missing, with the stats to match: nothing found, no pages read. */
export function emptyFactSheet(spec: TemplateSpec): EmptyFactSheet {
  const fields: Record<string, FactField> = {};
  for (const field of spec.fields) fields[field.id] = emptyField();
  const data: FactSheetData = { templateId: spec.id, fields };
  return { data, stats: recomputeStats(spec, data) };
}

/**
 * The missing fields in the order the question flow asks them: required
 * fields first, then the rest, each group in section order and then in the
 * spec's order. A field with no entry counts as missing. Found, contradicted,
 * and answered fields are left out: a conflict is settled on its card.
 */
export function questionOrder(spec: TemplateSpec, fields: Record<string, FactField | undefined>): TemplateField[] {
  const sectionOrder = new Map(spec.sections.map((s) => [s.id, s.order]));
  const rank = (field: TemplateField) => sectionOrder.get(field.section) ?? Number.MAX_SAFE_INTEGER;
  const missing = spec.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => (fields[field.id]?.status ?? "missing") === "missing")
    .sort((a, b) => rank(a.field) - rank(b.field) || a.index - b.index);
  return [...missing.filter((m) => m.field.required), ...missing.filter((m) => !m.field.required)].map((m) => m.field);
}
