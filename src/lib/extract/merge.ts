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
import {
  datesIn,
  dayKey,
  givenNamesCompatible,
  middleNameDropped,
  normalizeForCompare,
  normalizeItemKey,
  normalizeUrl,
  personNameKey,
  samePerson,
  timeKey,
} from "./normalize";

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

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

/** True when the finding's own evidence states the month of its ISO date ("February 7, 2018" for 2018-02-07, or the JSON-LD value itself). */
function monthInEvidence(f: Finding): boolean {
  const value = typeof f.value === "string" ? f.value.trim() : "";
  if (!ISO_DAY.test(value) && !ISO_MONTH.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return datesIn(f.quote).some((d) => d.month === month);
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
    // A full date outranks a bare year only when its own evidence states its month:
    // "2018-03" read from "the spring of 2018" does not beat "2018".
    const dated = findings.filter(monthInEvidence).map((f) => (f.value as string).trim());
    const iso = dated.find((v) => ISO_DAY.test(v)) ?? dated.find((v) => ISO_MONTH.test(v));
    if (iso) return iso;
    const year = strings.find((v) => /^\d{4}$/.test(v.trim()));
    if (year) return year.trim();
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

type Variant = {
  item: ListItem;
  evidence: Evidence[];
  order: number;
  /** The page and source this variant was read from. */
  from: Evidence;
  derived: boolean;
  note?: string;
};
/** promoted: the owner was set by the site-wide rule (see promoteSiteWideProfiles). */
type MergedItem = { item: ListItem; variants: Variant[]; promoted?: boolean };

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

/** Name-key tokens with hyphenated parts split, so "manhas-bains" counts as "manhas" and "bains". */
function nameParts(tokens: string[]): Set<string> {
  return new Set(tokens.flatMap((t) => t.split("-")).filter((t) => t.length > 1));
}

function sharesNamePart(a: string[], b: string[]): boolean {
  const partsOfB = nameParts(b);
  for (const part of nameParts(a)) if (partsOfB.has(part)) return true;
  return false;
}

/** The url-typed keys of a person item: profile page, LinkedIn, YouTube, and so on. */
function linkKeysOf(field: TemplateField): string[] {
  const keys = (field.itemShape ?? []).filter((s) => s.type === "url").map((s) => s.key);
  return keys.length ? keys : ["url"];
}

/**
 * The profile links of one variant, apart from a link to the page the variant
 * was read from (ownPage), which a model fills in for everyone on a team page,
 * and apart from list pages: pages whose text gave more than one name. A team
 * page given as each person's url is where they are listed, not who they are.
 */
function linksOf(field: TemplateField, v: Variant, listPages: Set<string>): { links: Set<string>; ownPage: string | null } {
  const page = normalizeUrl(v.from.url);
  const links = new Set<string>();
  let ownPage: string | null = null;
  for (const key of linkKeysOf(field)) {
    const link = normalizeUrl(v.item[key] ?? "");
    if (!link || listPages.has(link)) continue;
    if (link === page) ownPage = page;
    else links.add(link);
  }
  return { links, ownPage };
}

/**
 * True when two variants point at the same profile. Two links to the page
 * each was read from are not compared (everyone on /our-team/ would match),
 * but a variant read from a profile page that gives that page as its own does
 * match a variant elsewhere that links to it.
 */
function shareProfileLink(field: TemplateField, a: Variant, b: Variant, listPages: Set<string>): boolean {
  const la = linksOf(field, a, listPages);
  const lb = linksOf(field, b, listPages);
  for (const link of la.links) if (lb.links.has(link)) return true;
  return (lb.ownPage !== null && la.links.has(lb.ownPage)) || (la.ownPage !== null && lb.links.has(la.ownPage));
}

function samePage(a: Variant, b: Variant): boolean {
  const page = normalizeUrl(a.from.url);
  return !!page && page === normalizeUrl(b.from.url);
}

/**
 * Whether a person variant is the person a merged item already describes.
 * - Two different full names one source read from one page (its text, or its
 *   JSON-LD) are two people: a team page and an employee list name each
 *   person once. One that only leaves out the other's middle name or initial
 *   is the exception. This is checked first, so an exact match elsewhere in
 *   the item cannot pull a second person into it.
 * - The same name key is the same person.
 * - Names a typo apart, or with a middle name left out, are the same person.
 * - A single name that is part of a full name ("Jim" / "Jim Sabellico") is the
 *   same person when the two share a profile link or a page.
 * - Two full names that share a profile link are the same person only when
 *   they share a name part and their given names fit (equal, or one an initial
 *   or short form of the other: "Pal Manhas" / "Palvinder Manhas-Bains"). A
 *   shared surname is not a shared name: Mark and Mary Carter stay two people.
 */
function samePersonItem(field: TemplateField, target: MergedItem, v: Variant, listPages: Set<string>): boolean {
  const key = dedupeKeyOf(field);
  const nameKey = personNameKey(v.item[key] ?? "");
  if (!nameKey) return false;
  const tokens = nameKey.split(" ");
  const known = target.variants
    .map((x) => ({ x, nameKey: personNameKey(x.item[key] ?? "") }))
    .filter((k) => k.nameKey.length > 0);

  if (tokens.length >= 2 && (v.from.source === "page" || v.from.source === "jsonld")) {
    for (const k of known) {
      const other = k.nameKey.split(" ");
      if (k.nameKey === nameKey || other.length < 2) continue;
      if (k.x.from.source !== v.from.source || !samePage(k.x, v)) continue;
      if (!middleNameDropped(other, tokens)) return false;
    }
  }
  if (known.some((k) => k.nameKey === nameKey)) return true;

  for (const k of known) {
    if (samePerson(k.nameKey, nameKey)) return true;
    const other = k.nameKey.split(" ");
    if (!sharesNamePart(other, tokens)) continue;
    const sharedLink = shareProfileLink(field, k.x, v, listPages);
    if (other.length === 1 || tokens.length === 1) {
      if (sharedLink || samePage(k.x, v)) return true;
    } else if (sharedLink && givenNamesCompatible(other[0], tokens[0])) {
      return true;
    }
  }
  return false;
}

/** The key two items are compared by: days as a set of days, a time in minutes, otherwise the normalized text. */
function itemKeyFor(field: TemplateField, key: string, value: string | undefined): string {
  const check = field.itemShape?.find((s) => s.key === key)?.check;
  if (check === "days") return dayKey(value ?? "") || normalizeItemKey(value);
  if (check === "time") return timeKey(value ?? "") || normalizeItemKey(value);
  return normalizeItemKey(value);
}

function sameItem(field: TemplateField, target: MergedItem, v: Variant, listPages: Set<string>): boolean {
  if (field.itemKind === "person") return samePersonItem(field, target, v, listPages);
  const key = dedupeKeyOf(field);
  const a = target.item;
  const b = v.item;
  if (field.itemKind === "social") {
    const ua = normalizeUrl(a[key] ?? "");
    const ub = normalizeUrl(b[key] ?? "");
    return !!ua && ua === ub;
  }
  if (!key) return false;
  const ka = itemKeyFor(field, key, a[key]);
  const kb = itemKeyFor(field, key, b[key]);
  return !!ka && ka === kb;
}

function compareKey(field: TemplateField, key: string, value: string | undefined): string {
  if (!value) return "";
  if (field.itemKind === "person" && key === "name") return personNameKey(value);
  const shape = field.itemShape?.find((s) => s.key === key);
  if (shape?.type === "url") return normalizeUrl(value);
  return itemKeyFor(field, key, value);
}

/**
 * Pages whose text gave more than one name for one person field: team pages,
 * not anyone's profile. JSON-LD names do not count, because a site can carry
 * the same employee list on every page, profile pages included.
 */
function listPagesOf(field: TemplateField, findings: Finding[]): Set<string> {
  const names = new Map<string, Set<string>>();
  const key = dedupeKeyOf(field);
  for (const f of findings) {
    const page = normalizeUrl(f.url);
    if (!page || f.source !== "page") continue;
    for (const raw of itemsOf(field, f)) {
      const name = personNameKey(cleanItem(field, raw)?.[key] ?? "");
      if (!name) continue;
      const set = names.get(page);
      if (set) set.add(name);
      else names.set(page, new Set([name]));
    }
  }
  return new Set([...names].filter(([, set]) => set.size > 1).map(([page]) => page));
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

/** A LinkedIn /in/ (or old /pub/) link is always a person's profile, never a company page. */
const PERSONAL_PROFILE_LINK = /linkedin\.com\/(?:in|pub)\//i;

/**
 * Footer icons are on every page, so a profile nobody has claimed (no owner
 * from JSON-LD) that is linked from two or more pages is the business's own.
 * The owner is set to "business" and the item no longer counts as derived.
 */
function promoteSiteWideProfiles(field: TemplateField, merged: MergedItem[]): void {
  if (!(field.itemShape ?? []).some((s) => s.key === "owner")) return;
  const linkKey = dedupeKeyOf(field);
  for (const m of merged) {
    if (m.item.owner || PERSONAL_PROFILE_LINK.test(m.item[linkKey] ?? "")) continue;
    const pages = new Set(m.variants.map((v) => normalizeUrl(v.from.url)).filter(Boolean));
    if (pages.size < 2) continue;
    m.item.owner = "business";
    m.promoted = true;
  }
}

function itemDerived(m: MergedItem): boolean {
  return !m.promoted && m.variants.every((v) => v.derived);
}

/**
 * Up to three notes, in finding order. The caveat on a derived variant ("linked
 * from /about; confirm whose profile this is") is left out once another source
 * or the site-wide rule has confirmed its item.
 */
function listNote(merged: MergedItem[]): string | undefined {
  const entries: { order: number; note: string }[] = [];
  for (const m of merged) {
    const confirmed = !itemDerived(m);
    for (const v of m.variants) {
      if (v.note && !(v.derived && confirmed)) entries.push({ order: v.order, note: v.note });
    }
  }
  entries.sort((a, b) => a.order - b.order);
  const notes: string[] = [];
  for (const { note } of entries) {
    if (!notes.includes(note)) notes.push(note);
    if (notes.length === 3) break;
  }
  return notes.length ? notes.join("; ") : undefined;
}

/** True when one of the item's variants has exactly this person's name key. */
function hasName(field: TemplateField, m: MergedItem, nameKey: string): boolean {
  const key = dedupeKeyOf(field);
  return !!nameKey && m.variants.some((x) => personNameKey(x.item[key] ?? "") === nameKey);
}

function mergeList(field: TemplateField, findings: Finding[]): FactField {
  const merged: MergedItem[] = [];
  const evidence: Evidence[] = [];
  const person = field.itemKind === "person";
  const listPages = person ? listPagesOf(field, findings) : new Set<string>();
  let order = 0;

  for (const f of findings) {
    let used = false;
    const note = f.note?.trim();
    for (const raw of itemsOf(field, f)) {
      const item = cleanItem(field, raw);
      if (!item) continue;
      used = true;
      const from = evidenceOf(f);
      const variant: Variant = { item, evidence: [from], order: order++, from, derived: f.derived === true };
      if (note) variant.note = note;
      // A person goes to the item that already has their exact name before any looser match.
      const nameKey = person ? personNameKey(item[dedupeKeyOf(field)] ?? "") : "";
      const target =
        (person ? merged.find((m) => hasName(field, m, nameKey) && sameItem(field, m, variant, listPages)) : undefined) ??
        merged.find((m) => sameItem(field, m, variant, listPages));
      if (target) {
        for (const [key, value] of Object.entries(item)) {
          if (!target.item[key] && value) target.item[key] = value;
        }
        target.variants.push(variant);
      } else {
        merged.push({ item: { ...item }, variants: [variant] });
      }
    }
    if (used) evidence.push(evidenceOf(f));
  }
  if (!merged.length) return emptyField();

  if (field.itemKind === "social") promoteSiteWideProfiles(field, merged);

  const out: FactField = {
    value: merged.map((m) => m.item),
    status: "found",
    evidence: dedupeEvidence(evidence).slice(0, MAX_LIST_EVIDENCE),
  };
  const itemConflicts = merged.map((m) => conflictsOf(field, m)).filter((c): c is ListItemConflict => c !== null);
  if (itemConflicts.length) out.itemConflicts = itemConflicts;
  if (merged.every(itemDerived)) out.derived = true;
  const note = listNote(merged);
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
