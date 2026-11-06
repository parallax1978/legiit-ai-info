/*
  The JSON-LD graph: the organization and the about page with its FAQ, built
  from the fact sheet and the draft by code so nothing in it can be invented.
  The shape follows examples/legiit-schema.html (an Organization) and
  examples/darcy-bailey-schema.html (a LocalBusiness subtype with address,
  geo, map, areas served, opening hours, price range, and an offer catalog).
  Nothing without a value: empty strings, arrays, and objects are pruned.
*/
import { clockReadings, datesIn, dayName, daysNamed, normalizeUrl, samePerson, yearOf } from "@/lib/extract/normalize";
import type { AddressValue, FactSheetData, ListItem } from "@/lib/facts/types";
import { companyNameOf } from "@/lib/projects/view";
import type { TemplateSpec } from "@/templates/types";
import { awardLabel, fieldAddress, fieldList, fieldText, isBusinessOwner } from "./keyfacts";
import { oneLine, safeHref } from "./render";
import type { PageDraft } from "./types";

export interface JsonLdInput {
  spec: TemplateSpec;
  data: FactSheetData;
  draft: PageDraft;
  siteUrl: string;
  pageUrl: string;
}

type Node = Record<string, unknown>;

/** A person's link keys in the founders item shape, in the order they go into sameAs. */
const PERSON_LINK_KEYS = ["linkedin", "youtube", "x", "facebook", "instagram", "website"] as const;

// ---------------------------------------------------------------------------
// Small parsers, exported so they can be tested on their own
// ---------------------------------------------------------------------------

/** https://legiit.com for https://www.legiit.com/about/; the text itself when it is not a URL. */
export function siteOrigin(siteUrl: string): string {
  const raw = oneLine(siteUrl);
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function matchedType(spec: TemplateSpec, businessType: string): string | null {
  const key = oneLine(businessType).toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return null;
  return spec.schema.orgTypes.find((t) => t.toLowerCase() === key) ?? null;
}

/** True when the business type is a LocalBusiness subtype in the template, so the place properties apply. */
export function isLocalBusinessType(spec: TemplateSpec, businessType: string): boolean {
  const type = matchedType(spec, businessType);
  return type !== null && spec.schema.localBusinessTypes.includes(type);
}

/** The org @type: the business type, with "LocalBusiness" beside a subtype; Organization for anything unknown. */
export function orgType(spec: TemplateSpec, businessType: string): string | string[] {
  const type = matchedType(spec, businessType);
  if (!type) return "Organization";
  if (type === "LocalBusiness" || !spec.schema.localBusinessTypes.includes(type)) return type;
  return [type, "LocalBusiness"];
}

const ABBREVIATIONS = new Set([
  "inc", "ltd", "llc", "co", "corp", "plc", "pty", "pvt", "gmbh",
  "mr", "mrs", "ms", "dr", "prof", "st", "vs", "etc", "jr", "sr", "approx",
  "e.g", "i.e", "u.s", "u.k",
]);

/** The first sentence of a text. An initial ("Chris M. Walker"), an abbreviation ("Inc."), a decimal, or a domain does not end it. */
export function firstSentence(text: string): string {
  const s = oneLine(text);
  for (const m of s.matchAll(/[.!?]+["')\]]*(?=\s|$)/g)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    const word = (s.slice(0, at).match(/(\S+)$/)?.[1] ?? "").toLowerCase().replace(/^["'(\[]+/, "");
    if (/^[a-z]$/.test(word) || ABBREVIATIONS.has(word)) continue;
    const next = s.slice(end).trimStart();
    if (next && /^[a-z]/.test(next)) continue;
    return s.slice(0, end);
  }
  return s;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A founding date as ISO 8601: "2018-02-07" stays, "February 7, 2018" becomes
 * "2018-02-07", "February 2018" becomes "2018-02", "since 2018" becomes "2018".
 * Null when the text names no year.
 */
export function isoDate(value: string): string | null {
  const s = oneLine(value);
  if (!s) return null;
  if (/^\d{4}(-\d{2}){0,2}$/.test(s)) return s;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  if (iso) return iso[1];
  const year = yearOf(s);
  if (!year) return null;
  const parts = datesIn(s);
  if (parts.length === 1) {
    const { month, day } = parts[0];
    return day ? `${year}-${pad(month)}-${pad(day)}` : `${year}-${pad(month)}`;
  }
  return year;
}

/** The head count in a team size text: the number before "people" or "staff" when there is one, else the largest number. */
export function teamCount(value: string): number | null {
  const s = oneLine(value);
  if (!s) return null;
  const m = s.match(/(\d[\d,]*)\s*\+?\s*(?:people|person|persons|employees|staff|team members|members|strong)\b/i);
  if (m) return Number(m[1].replace(/,/g, ""));
  const numbers = [...s.matchAll(/\d[\d,]*/g)].map((n) => Number(n[0].replace(/,/g, ""))).filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) : null;
}

/** "49.119401, -122.6578649" as numbers, null when the text is not a pair of coordinates in range. */
export function geoCoordinates(value: string): { latitude: number; longitude: number } | null {
  const m = oneLine(value).match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;/ ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) return null;
  return { latitude, longitude };
}

const CURRENCY_CODE =
  /\b(USD|CAD|AUD|NZD|GBP|EUR|JPY|CNY|INR|CHF|SGD|HKD|MXN|BRL|ZAR|SEK|NOK|DKK|PLN|CZK|HUF|AED|PHP|THB|IDR|MYR|KRW|TRY|ILS)\b/i;
const CURRENCY_SYMBOLS: [RegExp, string][] = [
  [/(?:C|CA)\$/, "CAD"],
  [/(?:A|AU)\$/, "AUD"],
  [/NZ\$/, "NZD"],
  [/US\$/, "USD"],
  [/\$/, "USD"],
  [/£/, "GBP"],
  [/€/, "EUR"],
  [/¥/, "JPY"],
  [/₹/, "INR"],
];
const AMOUNT = /(C\$|CA\$|A\$|AU\$|NZ\$|US\$|\$|£|€|¥|₹)?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g;

/** An ISO currency code named in any of the texts ("CAD", "$170 + GST (CAD)"). */
export function currencyCode(...texts: string[]): string | null {
  for (const t of texts) {
    const m = oneLine(t).match(CURRENCY_CODE);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/** The currency a price's symbol says: "C$" CAD, "£" GBP, "$" USD. */
export function currencySymbol(text: string): string | null {
  const s = oneLine(text);
  for (const [re, code] of CURRENCY_SYMBOLS) if (re.test(s)) return code;
  return null;
}

function amountOf(m: RegExpMatchArray): string {
  return `${m[2].replace(/,/g, "")}${m[3] ?? ""}`;
}

/**
 * The one amount a price text states, as a decimal string: "$47 a month" is
 * "47", "$262.50" is "262.50", "Free" is "0", "$170 per 50-minute session"
 * is "170" (the amount with the symbol wins). A range or a pair of amounts
 * ("from $6, average order about $90") is null: no single price to state.
 */
export function parsePrice(price: string): string | null {
  const s = oneLine(price);
  if (!s) return null;
  const all = [...s.matchAll(AMOUNT)];
  const withSymbol = all.filter((m) => m[1]);
  if (withSymbol.length === 1) return amountOf(withSymbol[0]);
  if (withSymbol.length > 1) return null;
  if (/\bfree\b/i.test(s)) return "0";
  if (all.length === 1) return amountOf(all[0]);
  return null;
}

function hhmm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * OpeningHoursSpecification entries from hours items. Days are read as the
 * page wrote them ("Mon - Thu", "weekdays"), times as "HH:MM" 24-hour. A
 * time with no am or pm is read as written for opens, and for closes as the
 * reading after opens ("9" to "5" is 09:00 to 17:00). Items with no readable
 * days or times ("Closed") are left out.
 */
export function openingHours(items: ListItem[]): Node[] {
  const out: Node[] = [];
  for (const item of items) {
    const days = [...daysNamed(item.days ?? "")].sort((a, b) => a - b);
    if (!days.length) continue;
    const opensReadings = clockReadings(item.opens ?? "");
    const closesReadings = clockReadings(item.closes ?? "");
    if (!opensReadings?.length || !closesReadings?.length) continue;
    const opens = opensReadings[0];
    const closes = closesReadings.find((c) => c > opens) ?? closesReadings[closesReadings.length - 1];
    const names = days.map(dayName);
    out.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: names.length === 1 ? names[0] : names,
      opens: hhmm(opens),
      closes: hhmm(closes),
    });
  }
  return out;
}

const LANGUAGE_CODES: Record<string, string> = {
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it", portuguese: "pt", dutch: "nl",
  mandarin: "zh", chinese: "zh", cantonese: "yue", japanese: "ja", korean: "ko", arabic: "ar", hebrew: "he",
  hindi: "hi", punjabi: "pa", urdu: "ur", bengali: "bn", tamil: "ta", gujarati: "gu", farsi: "fa", persian: "fa",
  russian: "ru", ukrainian: "uk", polish: "pl", czech: "cs", greek: "el", turkish: "tr", tagalog: "tl",
  filipino: "fil", vietnamese: "vi", thai: "th", indonesian: "id", malay: "ms", swedish: "sv", norwegian: "no",
  danish: "da", finnish: "fi", hungarian: "hu", romanian: "ro", swahili: "sw", afrikaans: "af", "asl": "ase",
};

/** "English" as "en"; a language without a known code stays as written. */
export function languageCode(name: string): string {
  const s = oneLine(name);
  return LANGUAGE_CODES[s.toLowerCase()] ?? s;
}

// ---------------------------------------------------------------------------
// Pruning: nothing without a value
// ---------------------------------------------------------------------------

/** The value with every empty string, null, undefined, empty array, and empty object removed, recursively; undefined when nothing is left. */
export function prune(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (value !== null && typeof value === "object") {
    const out: Node = {};
    for (const [key, v] of Object.entries(value as Node)) {
      const p = prune(v);
      if (p !== undefined) out[key] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value === null || value === undefined) return undefined;
  return value;
}

function pruneNode(node: Node): Node | null {
  const out = prune(node);
  return out !== undefined && typeof out === "object" && !Array.isArray(out) ? (out as Node) : null;
}

/** A typed node, or null when no property besides @type has a value. */
function typed(type: string, props: Node): Node | null {
  const body = pruneNode(props);
  return body ? { "@type": type, ...body } : null;
}

// ---------------------------------------------------------------------------
// Pieces of the organization
// ---------------------------------------------------------------------------

function httpUrl(url: string | undefined): string | null {
  const href = safeHref(oneLine(url));
  return href && /^https?:\/\//i.test(href) ? href : null;
}

function personNode(item: ListItem, titleKey: "title" | "role", profiles: ListItem[], companyName: string): Node | null {
  const name = oneLine(item.name);
  if (!name) return null;
  const url = httpUrl(item.url);
  const seen = new Set<string>(url ? [normalizeUrl(url)] : []);
  const sameAs: string[] = [];
  const add = (raw: string | undefined) => {
    const u = httpUrl(raw);
    if (!u) return;
    const key = normalizeUrl(u);
    if (seen.has(key)) return;
    seen.add(key);
    sameAs.push(u);
  };
  for (const p of profiles) {
    if (isBusinessOwner(p.owner, companyName)) continue;
    if (samePerson(oneLine(p.owner), name)) add(p.url);
  }
  for (const key of PERSON_LINK_KEYS) add(item[key]);
  return typed("Person", {
    name,
    jobTitle: oneLine(item[titleKey]),
    honorificSuffix: oneLine(item.credentials),
    url,
    sameAs,
  });
}

function people(items: ListItem[], titleKey: "title" | "role", profiles: ListItem[], companyName: string): Node[] {
  return items.map((item) => personNode(item, titleKey, profiles, companyName)).filter((n): n is Node => n !== null);
}

function businessProfiles(profiles: ListItem[], companyName: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of profiles) {
    if (!isBusinessOwner(p.owner, companyName)) continue;
    const u = httpUrl(p.url);
    if (!u) continue;
    const key = normalizeUrl(u);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

/** PostalAddress from the address parts. An address that is only one line of text has no parts to map, so it is left out. */
function postalAddress(a: AddressValue | null): Node | null {
  if (!a) return null;
  return typed("PostalAddress", {
    streetAddress: oneLine(a.streetAddress),
    addressLocality: oneLine(a.addressLocality),
    addressRegion: oneLine(a.addressRegion),
    postalCode: oneLine(a.postalCode),
    addressCountry: oneLine(a.addressCountry),
  });
}

function names(items: ListItem[]): string[] {
  return items.map((i) => oneLine(i.name)).filter(Boolean);
}

function cities(items: ListItem[]): Node[] {
  return names(items).map((name) => ({ "@type": "City", name }));
}

function organizations(items: ListItem[]): Node[] {
  return names(items).map((name) => ({ "@type": "Organization", name }));
}

/**
 * An Offer per pricing item whose price parses to one amount. The currency is
 * the code the item names, else the code any item in the list names (one
 * catalog, one currency), else the item's symbol, else USD.
 */
function offerCatalog(items: ListItem[]): Node | null {
  const shared = currencyCode(...items.flatMap((i) => [i.price ?? "", i.notes ?? ""]));
  const offers: Node[] = [];
  for (const item of items) {
    const name = oneLine(item.name);
    const price = parsePrice(item.price ?? "");
    if (!name || price === null) continue;
    const priceCurrency = currencyCode(item.price ?? "", item.notes ?? "") ?? shared ?? currencySymbol(item.price ?? "") ?? "USD";
    offers.push({ "@type": "Offer", name, price, priceCurrency, description: oneLine(item.notes) });
  }
  if (!offers.length) return null;
  return { "@type": "OfferCatalog", name: "Prices and plans", itemListElement: offers };
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export function buildJsonLd(input: JsonLdInput): Record<string, unknown> {
  const { spec, data, draft, siteUrl, pageUrl } = input;
  const origin = siteOrigin(siteUrl);
  const orgId = `${origin}/#organization`;
  const companyName = companyNameOf(data.fields) ?? "";
  const businessType = fieldText(data, "business_type");
  const local = isLocalBusinessType(spec, businessType);
  const profiles = fieldList(data, "social_profiles");
  const logo = httpUrl(fieldText(data, "logo_url"));
  const description = firstSentence(draft.intro[0] ?? "") || oneLine(draft.metaDescription);
  const geo = local ? geoCoordinates(fieldText(data, "geo")) : null;
  const headCount = teamCount(fieldText(data, "team_size"));

  const org: Node = {
    "@type": orgType(spec, businessType),
    "@id": orgId,
    name: companyName,
    legalName: fieldText(data, "legal_name"),
    alternateName: names(fieldList(data, "alternate_names")),
    url: httpUrl(fieldText(data, "website_url")) ?? httpUrl(siteUrl) ?? origin,
    logo,
    image: local ? logo : null,
    description,
    telephone: fieldText(data, "phone"),
    email: fieldText(data, "email").replace(/^mailto:/i, ""),
    foundingDate: isoDate(fieldText(data, "founded_date")),
    founder: people(fieldList(data, "founders"), "title", profiles, companyName),
    employee: people(fieldList(data, "team_members"), "role", profiles, companyName),
    numberOfEmployees: headCount === null ? null : { "@type": "QuantitativeValue", value: headCount },
    address: postalAddress(fieldAddress(data, "headquarters")),
    geo: geo ? { "@type": "GeoCoordinates", ...geo } : null,
    hasMap: local ? httpUrl(fieldText(data, "map_url")) : null,
    areaServed: local ? cities(fieldList(data, "area_served")) : null,
    openingHoursSpecification: local ? openingHours(fieldList(data, "hours")) : null,
    priceRange: local ? fieldText(data, "price_range") : null,
    knowsLanguage: names(fieldList(data, "languages")).map(languageCode),
    award: fieldList(data, "awards").map(awardLabel).filter(Boolean),
    memberOf: organizations(fieldList(data, "memberships")),
    hasOfferCatalog: offerCatalog(fieldList(data, "pricing")),
    sameAs: businessProfiles(profiles, companyName),
  };

  const faq = draft.faq.filter((f) => oneLine(f.question) && oneLine(f.answer));
  const page: Node = {
    "@type": faq.length ? ["AboutPage", "FAQPage"] : "AboutPage",
    "@id": `${pageUrl}#webpage`,
    url: pageUrl,
    name: oneLine(draft.metaTitle) || oneLine(draft.title),
    description: oneLine(draft.metaDescription) || description,
    inLanguage: "en",
    about: { "@id": orgId },
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return { "@context": "https://schema.org", "@graph": [pruneNode(org) ?? {}, pruneNode(page) ?? {}] };
}
