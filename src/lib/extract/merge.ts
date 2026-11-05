/*
  Merge verified findings from every page into one fact sheet keyed by template
  field id, with found / missing / conflict statuses, and apply user edits to it.
  Pure: no server imports.
*/
import {
  emptyField,
  type AddressValue,
  type Candidate,
  type Evidence,
  type FactField,
  type FactSheetData,
  type FactSheetStats,
  type FactValue,
  type Finding,
  type ListItem,
  type ListItemConflict,
} from "@/lib/facts/types";
import type { TemplateField, TemplateSpec } from "@/templates/types";
import { normalizeForCompare, normalizeItemKey, normalizeUrl, personNameKey, samePerson } from "./normalize";

/** Evidence entries kept per list field; the earliest win. */
export const MAX_LIST_EVIDENCE = 20;

export interface MergeOptions {
  pagesUsed?: number;
  droppedCount?: number;
}

export interface MergeResult {
  data: FactSheetData;
  stats: FactSheetStats;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function evidenceOf(f: Finding): Evidence {
  return { quote: f.quote, url: f.url, source: f.source };
}

function dedupeEvidence(list: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of list) {
    const key = `${e.url}\u0000${e.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function joinNotes(findings: Finding[]): string | undefined {
  const notes: string[] = [];
  for (const f of findings) {
    const n = f.note?.trim();
    if (n && !notes.includes(n)) notes.push(n);
    if (notes.length === 3) break;
  }
  return notes.length ? notes.join("; ") : undefined;
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const v of values) {
    const count = counts.get(v) ?? 0;
    if (count > bestCount || (count === bestCount && v.length > best.length)) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}

function addressParts(a: AddressValue): number {
  return [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry].filter(Boolean).length;
}

/** The most complete raw value in a group of findings that agree. */
function bestValue(field: TemplateField, findings: Finding[]): FactValue {
  if (field.type === "address") {
    let best: AddressValue | null = null;
    for (const f of findings) {
      const value = typeof f.value === "string" ? { text: f.value } : f.value;
      if (!value || Array.isArray(value)) continue;
      if (
        !best ||
        addressParts(value) > addressParts(best) ||
        (addressParts(value) === addressParts(best) && (value.text ?? "").length > (best.text ?? "").length)
      ) {
        best = value;
      }
    }
    return best ? clone(best) : null;
  }
  const strings = findings.map((f) => f.value).filter((v): v is string => typeof v === "string" && v.length > 0);
  if (!strings.length) return null;
  if (field.type === "date") {
    const iso =
      strings.find((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) ?? strings.find((v) => /^\d{4}-\d{2}$/.test(v.trim()));
    if (iso) return iso.trim();
  }
  return mostCommon(strings);
}

type Group = { findings: Finding[]; evidence: Evidence[]; maxConfidence: number; order: number };

function scalarValueOf(field: TemplateField, f: Finding): string | AddressValue | null {
  if (f.value == null || Array.isArray(f.value)) return null;
  if (typeof f.value === "object") return field.type === "address" ? f.value : (f.value.text ?? null);
  if (field.type === "address") return { text: f.value };
  return f.value;
}

function mergeScalar(field: TemplateField, findings: Finding[]): FactField {
  const groups = new Map<string, Group>();
  for (const f of findings) {
    const value = scalarValueOf(field, f);
    if (value == null) continue;
    const key = normalizeForCompare(field.type, value);
    if (!key) continue;
    const group = groups.get(key);
    if (group) {
      group.findings.push(f);
      group.evidence = dedupeEvidence([...group.evidence, evidenceOf(f)]);
      group.maxConfidence = Math.max(group.maxConfidence, f.confidence);
    } else {
      groups.set(key, { findings: [f], evidence: [evidenceOf(f)], maxConfidence: f.confidence, order: groups.size });
    }
  }
  if (!groups.size) return emptyField();

  const ordered = [...groups.values()].sort(
    (a, b) => b.evidence.length - a.evidence.length || b.maxConfidence - a.maxConfidence || a.order - b.order,
  );
  const used = ordered.flatMap((g) => g.findings);
  const derived = used.every((f) => f.derived === true);
  const note = joinNotes(used);

  const candidates: Candidate[] = ordered.map((g) => ({ value: bestValue(field, g.findings), evidence: g.evidence }));
  const lead = candidates[0];
  const out: FactField = {
    value: lead.value,
    status: ordered.length === 1 ? "found" : "conflict",
    evidence: lead.evidence,
  };
  if (ordered.length > 1) out.candidates = candidates;
  if (derived) out.derived = true;
  if (note) out.note = note;
  return out;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

type Variant = { item: ListItem; evidence: Evidence[]; order: number };
type MergedItem = { item: ListItem; variants: Variant[] };

function itemsOf(field: TemplateField, f: Finding): ListItem[] {
  if (Array.isArray(f.value)) return f.value;
  if (typeof f.value === "string" && f.value.trim()) {
    const key = field.dedupeKey ?? field.itemShape?.[0]?.key;
    return key ? [{ [key]: f.value.trim() }] : [];
  }
  return [];
}

/** Trimmed values, item-shape keys only, nothing empty. */
function cleanItem(field: TemplateField, raw: ListItem): ListItem | null {
  if (!raw || typeof raw !== "object") return null;
  const allowed = field.itemShape?.length ? new Set(field.itemShape.map((s) => s.key)) : null;
  const item: ListItem = {};
  for (const [key, value] of Object.entries(raw)) {
    if (allowed && !allowed.has(key)) continue;
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (v) item[key] = v;
  }
  if (!Object.keys(item).length) return null;
  const key = dedupeKeyOf(field);
  if (key && !item[key]) return null;
  return item;
}

function dedupeKeyOf(field: TemplateField): string {
  if (field.dedupeKey) return field.dedupeKey;
  if (field.itemKind === "person") return "name";
  if (field.itemKind === "social") return "url";
  return field.itemShape?.[0]?.key ?? "";
}

function sameItem(field: TemplateField, a: ListItem, b: ListItem): boolean {
  const key = dedupeKeyOf(field);
  if (field.itemKind === "person") {
    const ua = normalizeUrl(a.url ?? "");
    const ub = normalizeUrl(b.url ?? "");
    if (ua && ub && ua === ub) return true;
    return samePerson(a[key] ?? "", b[key] ?? "");
  }
  if (field.itemKind === "social") {
    const ua = normalizeUrl(a[key] ?? "");
    const ub = normalizeUrl(b[key] ?? "");
    return !!ua && ua === ub;
  }
  if (!key) return false;
  const ka = normalizeItemKey(a[key]);
  const kb = normalizeItemKey(b[key]);
  return !!ka && ka === kb;
}

function compareKey(field: TemplateField, key: string, value: string | undefined): string {
  if (!value) return "";
  if (field.itemKind === "person" && key === "name") return personNameKey(value);
  const shape = field.itemShape?.find((s) => s.key === key);
  if (shape?.type === "url") return normalizeUrl(value);
  return normalizeItemKey(value);
}

function conflictsOf(field: TemplateField, merged: MergedItem): ListItemConflict | null {
  if (merged.variants.length < 2) return null;
  const keys = [...(field.conflictOn ?? [])];
  const nameKey = dedupeKeyOf(field);
  if (field.itemKind === "person" && nameKey && !keys.includes(nameKey)) keys.unshift(nameKey);

  const disagreeing: string[] = [];
  for (const key of keys) {
    const distinct = new Set(
      merged.variants.map((v) => compareKey(field, key, v.item[key])).filter((k) => k.length > 0),
    );
    if (distinct.size > 1) disagreeing.push(key);
  }
  if (!disagreeing.length) return null;

  const groups = new Map<string, Variant[]>();
  for (const v of merged.variants) {
    const signature = disagreeing.map((key) => compareKey(field, key, v.item[key]));
    if (signature.every((s) => s.length === 0)) continue;
    const sig = signature.join("\u0000");
    const g = groups.get(sig);
    if (g) g.push(v);
    else groups.set(sig, [v]);
  }
  const candidates: Candidate[] = [...groups.values()]
    .map((variants) => ({
      value: [clone(variants[0].item)] as ListItem[],
      evidence: dedupeEvidence(variants.flatMap((v) => v.evidence)),
      order: variants[0].order,
    }))
    .sort((a, b) => b.evidence.length - a.evidence.length || a.order - b.order)
    .map(({ value, evidence }) => ({ value, evidence }));

  return { key: merged.item[nameKey] ?? Object.values(merged.item)[0] ?? "", on: disagreeing, candidates };
}

function mergeList(field: TemplateField, findings: Finding[]): FactField {
  const merged: MergedItem[] = [];
  const contributing: Finding[] = [];
  const evidence: Evidence[] = [];
  let order = 0;

  for (const f of findings) {
    let used = false;
    for (const raw of itemsOf(field, f)) {
      const item = cleanItem(field, raw);
      if (!item) continue;
      used = true;
      const variant: Variant = { item, evidence: [evidenceOf(f)], order: order++ };
      const target = merged.find((m) => sameItem(field, m.item, item));
      if (target) {
        for (const [key, value] of Object.entries(item)) {
          if (!target.item[key] && value) target.item[key] = value;
        }
        target.variants.push(variant);
      } else {
        merged.push({ item: { ...item }, variants: [variant] });
      }
    }
    if (used) {
      contributing.push(f);
      evidence.push(evidenceOf(f));
    }
  }
  if (!merged.length) return emptyField();

  const out: FactField = {
    value: merged.map((m) => m.item),
    status: "found",
    evidence: dedupeEvidence(evidence).slice(0, MAX_LIST_EVIDENCE),
  };
  const itemConflicts = merged.map((m) => conflictsOf(field, m)).filter((c): c is ListItemConflict => c !== null);
  if (itemConflicts.length) out.itemConflicts = itemConflicts;
  if (contributing.every((f) => f.derived === true)) out.derived = true;
  const note = joinNotes(contributing);
  if (note) out.note = note;
  return out;
}

// ---------------------------------------------------------------------------
// Merge and stats
// ---------------------------------------------------------------------------

/**
 * One fact sheet from the verified findings of every page. Scalars group by
 * normalized value (one group is found, more is a conflict with candidates);
 * lists union their items and carry per-item conflicts. Fields with nothing
 * are missing.
 */
export function mergeFindings(spec: TemplateSpec, findings: Finding[], opts: MergeOptions = {}): MergeResult {
  const byField = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!f || typeof f.fieldId !== "string") continue;
    const list = byField.get(f.fieldId);
    if (list) list.push(f);
    else byField.set(f.fieldId, [f]);
  }

  const fields: Record<string, FactField> = {};
  for (const field of spec.fields) {
    const fs = byField.get(field.id) ?? [];
    fields[field.id] = field.type === "list" ? mergeList(field, fs) : mergeScalar(field, fs);
  }

  const data: FactSheetData = { templateId: spec.id, fields };
  const dropped = opts.droppedCount ?? 0;
  const pagesUsed = opts.pagesUsed ?? new Set(findings.map((f) => f.url).filter(Boolean)).size;
  const stats = recomputeStats(spec, data, {
    pagesUsed,
    findingsTotal: findings.length + dropped,
    findingsDropped: dropped,
  });
  return { data, stats };
}

/** Status counts from the sheet; pagesUsed and the findings counters carry over from prev. */
export function recomputeStats(spec: TemplateSpec, data: FactSheetData, prev?: Partial<FactSheetStats>): FactSheetStats {
  const stats: FactSheetStats = {
    found: 0,
    missing: 0,
    conflict: 0,
    userProvided: 0,
    requiredMissing: 0,
    pagesUsed: prev?.pagesUsed ?? 0,
    findingsTotal: prev?.findingsTotal ?? 0,
    findingsDropped: prev?.findingsDropped ?? 0,
  };
  for (const field of spec.fields) {
    const status = data.fields[field.id]?.status ?? "missing";
    if (status === "found") stats.found++;
    else if (status === "conflict") stats.conflict++;
    else if (status === "user_provided") stats.userProvided++;
    else stats.missing++;
    if (field.required && (status === "missing" || status === "conflict")) stats.requiredMissing++;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// User edits
// ---------------------------------------------------------------------------

export type UserEdit =
  | { value: FactValue; note?: string }
  | { pickCandidate: number }
  | { pickItemCandidate: { conflictKey: string; index: number } }
  | { clear: true };

/** An ISO timestamp, or a function that returns one. */
export type Clock = string | (() => string);

function quoteForValue(value: FactValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        Object.values(item)
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .join(" / "),
      )
      .filter(Boolean)
      .join(", ")
      .slice(0, 500);
  }
  return (
    value.text ??
    [value.streetAddress, value.addressLocality, value.addressRegion, value.postalCode, value.addressCountry]
      .filter(Boolean)
      .join(", ")
  );
}

function crawledSnapshot(field: FactField): FactField["crawled"] {
  if (field.crawled) return field.crawled;
  if (field.status === "user_provided") return undefined;
  const snapshot: NonNullable<FactField["crawled"]> = {
    value: clone(field.value),
    status: field.status,
    evidence: clone(field.evidence),
  };
  if (field.candidates) snapshot.candidates = clone(field.candidates);
  if (field.itemConflicts) snapshot.itemConflicts = clone(field.itemConflicts);
  return snapshot;
}

function itemScore(item: ListItem, candidates: Candidate[]): number {
  let score = 0;
  for (const c of candidates) {
    for (const candidateItem of Array.isArray(c.value) ? c.value : []) {
      for (const [key, value] of Object.entries(candidateItem)) {
        if (value && item[key] && normalizeItemKey(item[key]) === normalizeItemKey(value)) score++;
      }
    }
  }
  return score;
}

/**
 * Applies one user edit and returns the new field. The crawled state is kept
 * in field.crawled the first time a field is edited; clear restores it.
 */
export function applyUserEdit(field: FactField, edit: UserEdit, now: Clock = () => new Date().toISOString()): FactField {
  const at = typeof now === "function" ? now() : now;

  if ("clear" in edit) {
    const base = field.crawled;
    const restored: FactField = base
      ? { value: clone(base.value), status: base.status, evidence: clone(base.evidence) }
      : emptyField();
    if (base?.candidates) restored.candidates = clone(base.candidates);
    const itemConflicts = base?.itemConflicts ?? field.itemConflicts;
    if (itemConflicts) restored.itemConflicts = clone(itemConflicts);
    if (base && field.derived) restored.derived = true;
    if (field.note) restored.note = field.note;
    restored.updatedAt = at;
    return restored;
  }

  const crawled = crawledSnapshot(field);
  const next: FactField = { ...field, status: "user_provided", updatedAt: at };
  if (crawled) next.crawled = crawled;
  else delete next.crawled;
  delete next.derived;

  if ("pickCandidate" in edit) {
    const candidate = field.candidates?.[edit.pickCandidate];
    if (!candidate) throw new Error(`No candidate at index ${edit.pickCandidate}`);
    next.value = clone(candidate.value);
    next.evidence = clone(candidate.evidence);
    delete next.candidates;
    return next;
  }

  if ("pickItemCandidate" in edit) {
    const { conflictKey, index } = edit.pickItemCandidate;
    const conflicts = field.itemConflicts ?? [];
    const conflict =
      conflicts.find((c) => c.key === conflictKey) ??
      conflicts.find((c) => normalizeItemKey(c.key) === normalizeItemKey(conflictKey));
    if (!conflict) throw new Error(`No item conflict for key "${conflictKey}"`);
    const candidate = conflict.candidates[index];
    const picked = candidate && Array.isArray(candidate.value) ? candidate.value[0] : undefined;
    if (!picked) throw new Error(`No item candidate at index ${index} for key "${conflictKey}"`);

    const list = Array.isArray(field.value) ? field.value.map((item) => ({ ...item })) : [];
    let target = -1;
    let best = 0;
    list.forEach((item, i) => {
      const score = itemScore(item, conflict.candidates);
      if (score > best) {
        best = score;
        target = i;
      }
    });
    if (target < 0) {
      target = list.findIndex((item) =>
        Object.values(item).some((v) => v && normalizeItemKey(v) === normalizeItemKey(conflict.key)),
      );
    }
    if (target < 0) {
      list.push({ ...picked });
    } else {
      for (const [key, value] of Object.entries(picked)) {
        if (value) list[target][key] = value;
      }
    }
    next.value = list;
    next.evidence = dedupeEvidence([...field.evidence, ...candidate.evidence]);
    const remaining = conflicts.filter((c) => c !== conflict);
    if (remaining.length) next.itemConflicts = clone(remaining);
    else delete next.itemConflicts;
    return next;
  }

  next.value = clone(edit.value);
  next.evidence = dedupeEvidence([...field.evidence, { quote: quoteForValue(edit.value), url: "", source: "user" }]);
  delete next.candidates;
  delete next.itemConflicts;
  if (edit.note !== undefined) {
    const note = edit.note.trim();
    if (note) next.note = note;
    else delete next.note;
  }
  return next;
}
