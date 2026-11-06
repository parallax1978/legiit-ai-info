/*
  The owner's edits survive a new scan. A field the owner set on the last fact
  sheet (a value they typed, a candidate they picked, an answer in manual
  mode) keeps their value on the sheet the new scan builds; what the scan
  found goes under `crawled`, so the review screen can still show it and
  "clear" restores it. Fields the owner never touched take the scan's result.
*/
import type { FactField, FactSheetData } from "./types";

export interface CarriedEdits {
  data: FactSheetData;
  /** The ids of the fields that kept the owner's value, in the order of the new sheet. */
  carried: string[];
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function crawledOf(field: FactField): NonNullable<FactField["crawled"]> {
  const snapshot: NonNullable<FactField["crawled"]> = {
    value: clone(field.value),
    status: field.status,
    evidence: clone(field.evidence),
  };
  if (field.candidates) snapshot.candidates = clone(field.candidates);
  if (field.itemConflicts) snapshot.itemConflicts = clone(field.itemConflicts);
  return snapshot;
}

/**
 * The new sheet with the owner's edits from the previous one on top. Only
 * fields in `user_provided` status carry, only onto a field the new sheet
 * has, and only between sheets of the same template. Returns the ids that
 * carried so the run can say so.
 */
export function carryUserEdits(prev: FactSheetData | null | undefined, next: FactSheetData): CarriedEdits {
  const carried: string[] = [];
  if (!prev || prev.templateId !== next.templateId || !prev.fields || typeof prev.fields !== "object") {
    return { data: next, carried };
  }
  const fields: Record<string, FactField> = {};
  for (const [id, fresh] of Object.entries(next.fields)) {
    const old = prev.fields[id];
    if (!old || old.status !== "user_provided") {
      fields[id] = fresh;
      continue;
    }
    const kept: FactField = {
      value: clone(old.value),
      status: "user_provided",
      evidence: clone(old.evidence),
      crawled: crawledOf(fresh),
    };
    if (old.note) kept.note = old.note;
    if (old.updatedAt) kept.updatedAt = old.updatedAt;
    fields[id] = kept;
    carried.push(id);
  }
  return { data: { ...next, fields }, carried };
}
