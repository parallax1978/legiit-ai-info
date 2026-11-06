/*
  The Key facts table, built from the fact sheet by code so nothing in it can
  be invented. Each row takes the first field in its `from` list that has a
  value and formats it for people: people as "Name, Title", prices as
  "name: price (notes)", services as names, social profiles grouped by owner,
  addresses on one line, dates spelled out, links as <a>. Rows with nothing
  are left out. The value helpers at the end are shared with the schema builder.
*/
import { normalizeUrl, platformFromUrl } from "@/lib/extract/normalize";
import type { AddressValue, FactSheetData, FactValue, ListItem } from "@/lib/facts/types";
import {
  companyNameOf,
  formatAddress,
  formatListItem,
  hostPath,
  isAddressValue,
  isEmptyValue,
  isListValue,
} from "@/lib/projects/view";
import type { TemplateField, TemplateSpec } from "@/templates/types";
import { escapeHtml, oneLine, safeHref } from "./render";
import type { KeyFactRow } from "./types";

// ---------------------------------------------------------------------------
// Cells: the same content as escaped HTML and as plain text
// ---------------------------------------------------------------------------

interface Cell {
  html: string;
  text: string;
}

function plain(text: string): Cell {
  return { html: escapeHtml(text), text };
}

/** A link when the address is safe to link to, else the label as text. */
function link(url: string, label: string): Cell {
  const href = safeHref(url);
  const text = label || oneLine(url);
  if (!href || !text) return plain(text);
  return { html: `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`, text };
}

function joinCells(cells: Cell[], separator: string): Cell {
  return {
    html: cells.map((c) => c.html).join(escapeHtml(separator)),
    text: cells.map((c) => c.text).join(separator),
  };
}

function withPrefix(prefix: string, cell: Cell): Cell {
  return { html: `${escapeHtml(prefix)}${cell.html}`, text: `${prefix}${cell.text}` };
}

function nonEmpty(cell: Cell): Cell | null {
  return cell.text.trim() ? cell : null;
}

/** ", " between short items; "; " once an item carries a comma of its own. */
function listSeparator(cells: Cell[]): string {
  return cells.some((c) => c.text.includes(",")) ? "; " : ", ";
}

// ---------------------------------------------------------------------------
// One value, by field type and item kind
// ---------------------------------------------------------------------------

function scalarCell(field: TemplateField, value: string): Cell | null {
  const s = oneLine(value);
  if (!s) return null;
  switch (field.type) {
    case "url":
      return link(s, hostPath(s));
    case "email": {
      const email = s.replace(/^mailto:/i, "");
      return link(`mailto:${email}`, email);
    }
    case "date":
      return plain(formatDate(s));
    default:
      return plain(s);
  }
}

/** "Chris M. Walker, Founder and CEO"; credentials between the name and the title. */
function personCell(item: ListItem): Cell | null {
  const name = oneLine(item.name);
  if (!name) return null;
  const parts = [name, oneLine(item.credentials), oneLine(item.title) || oneLine(item.role)].filter(Boolean);
  return plain(parts.join(", "));
}

/** "Legiit Leads Starter: $47 a month (50 searches; first 7 days free)". */
function priceCell(item: ListItem): Cell | null {
  const name = oneLine(item.name);
  const price = oneLine(item.price);
  const notes = oneLine(item.notes);
  if (!name && !price) return null;
  const head = name && price ? `${name}: ${price}` : name || price;
  return plain(notes ? `${head} (${notes})` : head);
}

/** The service's name, linked to its page when it has one. */
function serviceCell(item: ListItem): Cell | null {
  const name = oneLine(item.name);
  if (!name) return null;
  const url = oneLine(item.url);
  return url ? link(url, name) : plain(name);
}

function awardCell(item: ListItem): Cell | null {
  const label = awardLabel(item);
  return label ? plain(label) : null;
}

/** Opening hours as "Days opens to closes"; otherwise the first item key that has a value. */
function genericCell(field: TemplateField, item: ListItem): Cell | null {
  const days = oneLine(item.days);
  const opens = oneLine(item.opens);
  const closes = oneLine(item.closes);
  if (days && (opens || closes)) {
    const span = opens && closes ? `${opens} to ${closes}` : opens || closes;
    return plain(`${days} ${span}`);
  }
  const keys = field.itemShape?.length ? field.itemShape.map((s) => s.key) : Object.keys(item);
  for (const key of keys) {
    const v = oneLine(item[key]);
    if (v) return plain(v);
  }
  const all = oneLine(formatListItem(field, item));
  return all ? plain(all) : null;
}

interface SocialGroup {
  label: string;
  cells: Cell[];
  seen: Set<string>;
}

/**
 * Profiles grouped by owner: the business first, then each person. Group
 * labels ("Legiit: ", "Chris M. Walker: ") appear when there is more than one
 * group or the one group is a person's.
 */
function socialCell(items: ListItem[], companyName: string): Cell | null {
  const business: SocialGroup = { label: companyName || "The business", cells: [], seen: new Set() };
  const people = new Map<string, SocialGroup>();
  for (const item of items) {
    const url = oneLine(item.url);
    if (!url) continue;
    let group = business;
    if (!isBusinessOwner(item.owner, companyName)) {
      const owner = oneLine(item.owner);
      const key = owner.toLowerCase();
      group = people.get(key) ?? { label: owner, cells: [], seen: new Set() };
      people.set(key, group);
    }
    const key = normalizeUrl(url);
    if (group.seen.has(key)) continue;
    group.seen.add(key);
    group.cells.push(link(url, socialLabel(item.platform, url)));
  }
  const groups = [business, ...people.values()].filter((g) => g.cells.length);
  if (!groups.length) return null;
  const labelled = groups.length > 1 || groups[0] !== business;
  return joinCells(
    groups.map((g) => {
      const links = joinCells(g.cells, ", ");
      return labelled ? withPrefix(`${g.label}: `, links) : links;
    }),
    ". ",
  );
}

function listCell(field: TemplateField, value: ListItem[], companyName: string): Cell | null {
  const items = cleanItems(value);
  if (!items.length) return null;
  const collect = (f: (item: ListItem) => Cell | null): Cell[] => items.map(f).filter((c): c is Cell => c !== null);
  switch (field.itemKind) {
    case "person":
      return nonEmpty(joinCells(collect(personCell), "; "));
    case "price":
      return nonEmpty(joinCells(collect(priceCell), ". "));
    case "service": {
      const cells = collect(serviceCell);
      return nonEmpty(joinCells(cells, listSeparator(cells)));
    }
    case "social":
      return socialCell(items, companyName);
    case "award":
      return nonEmpty(joinCells(collect(awardCell), "; "));
    default: {
      const cells = collect((item) => genericCell(field, item));
      return nonEmpty(joinCells(cells, listSeparator(cells)));
    }
  }
}

function cellFor(field: TemplateField, value: FactValue, companyName: string): Cell | null {
  if (typeof value === "string") return scalarCell(field, value);
  if (isListValue(value)) return listCell(field, value, companyName);
  if (isAddressValue(value)) {
    const line = oneLine(formatAddress(value));
    return line ? plain(line) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export function keyFactsRows(spec: TemplateSpec, data: FactSheetData): KeyFactRow[] {
  const fields = new Map(spec.fields.map((f) => [f.id, f] as const));
  const companyName = companyNameOf(data.fields) ?? "";
  const rows: KeyFactRow[] = [];
  for (const row of spec.keyFactsRows) {
    for (const id of row.from) {
      const field = fields.get(id);
      if (!field) continue;
      const value = fieldValue(data, id);
      if (value === null) continue;
      const cell = cellFor(field, value, companyName);
      if (!cell) continue;
      rows.push({ label: row.label, html: cell.html, text: cell.text });
      break;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Values: what a field is worth, shared with the schema builder
// ---------------------------------------------------------------------------

/**
 * The field's value when it has one: found, user-provided, or the merged
 * value of a conflict (never a candidate). A missing field, or an empty
 * value, is null.
 */
export function fieldValue(data: FactSheetData, id: string): FactValue {
  const field = data.fields[id];
  if (!field || field.status === "missing") return null;
  const value = field.value;
  if (value === null || value === undefined || isEmptyValue(value)) return null;
  return value;
}

/** The field's text, one line; empty when it has no value or is not a text field. */
export function fieldText(data: FactSheetData, id: string): string {
  const value = fieldValue(data, id);
  return typeof value === "string" ? oneLine(value) : "";
}

/** The field's list items, cleaned; empty when it has no value or is not a list. */
export function fieldList(data: FactSheetData, id: string): ListItem[] {
  const value = fieldValue(data, id);
  return isListValue(value) ? cleanItems(value) : [];
}

export function fieldAddress(data: FactSheetData, id: string): AddressValue | null {
  const value = fieldValue(data, id);
  return isAddressValue(value) ? value : null;
}

/** Items with every value on one line and empty keys dropped; items with nothing left are dropped too. */
export function cleanItems(items: ListItem[]): ListItem[] {
  const out: ListItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const clean: ListItem = {};
    for (const [key, raw] of Object.entries(item)) {
      const v = oneLine(raw);
      if (v) clean[key] = v;
    }
    if (Object.keys(clean).length) out.push(clean);
  }
  return out;
}

/** True for a profile that belongs to the business rather than a person: no owner, "business", or the company's name. */
export function isBusinessOwner(owner: string | undefined, companyName: string): boolean {
  const o = oneLine(owner).toLowerCase();
  if (!o || o === "business" || o === "the business" || o === "company" || o === "the company") return true;
  const c = oneLine(companyName).toLowerCase();
  return c.length > 0 && o === c;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2018-02-07" as "February 7, 2018", "2018-02" as "February 2018"; any other text as it is. */
export function formatDate(value: string): string {
  const s = oneLine(value);
  const m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (!m) return s;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return s;
  if (!m[3]) return `${month} ${m[1]}`;
  const day = Number(m[3]);
  if (!(day >= 1 && day <= 31)) return s;
  return `${month} ${day}, ${m[1]}`;
}

const SOCIAL_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  x: "X",
  twitter: "X",
  tiktok: "TikTok",
  threads: "Threads",
  pinterest: "Pinterest",
  google: "Google Business Profile",
  snapchat: "Snapchat",
  reddit: "Reddit",
  github: "GitHub",
  vimeo: "Vimeo",
  yelp: "Yelp",
};

/** "YouTube", "LinkedIn", "X"; a website shows its host and path ("chrismwalker.io"). */
export function socialLabel(platform: string | undefined, url: string): string {
  const given = oneLine(platform).toLowerCase();
  const resolved = given && given !== "website" ? given : (platformFromUrl(url) ?? "website");
  if (resolved === "website") return hostPath(url) || oneLine(platform) || oneLine(url);
  const label = SOCIAL_LABELS[resolved];
  if (label) return label;
  return resolved.charAt(0).toUpperCase() + resolved.slice(1);
}

/** "Canadian Choice Award Winner, Mental Health Services, Langley (2024)": the issuer is added only when the name does not already say it. */
export function awardLabel(item: ListItem): string {
  const name = oneLine(item.name);
  if (!name) return "";
  const issuer = oneLine(item.issuer);
  const year = oneLine(item.year);
  const lower = name.toLowerCase();
  const issuerSaid =
    issuer.length > 0 &&
    issuer
      .toLowerCase()
      .split(/\s+/)
      .every((w) => lower.includes(w.replace(/s$/, "")));
  let s = issuer && !issuerSaid ? `${name}, ${issuer}` : name;
  if (year && !s.includes(year)) s += ` (${year})`;
  return s;
}
