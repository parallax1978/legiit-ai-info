/*
  Quote and value verification. The extractor may not set a field without a
  quote that is a verbatim substring of the page text after whitespace
  normalization, and the value has to be one the quote states: the numbers in
  it must be in the quote and its words on the page. Findings that fail either
  check are dropped and counted, each with a short reason for debugging.
*/
import type { AddressValue, FactValue, Finding, ListItem } from "@/lib/facts/types";
import { ABOUT_V1 } from "@/templates/about-v1";
import type { TemplateField, TemplateSpec } from "@/templates/types";
import { normalizePhone, normalizeUrl, personNameKey, platformFromUrl, straightenText, yearOf } from "./normalize";

/**
 * A quote that is not on the page in full keeps its longest leading run of
 * words that is, when that run is at least this many characters long. The run
 * becomes the finding's quote and the value is checked against it. A shorter
 * run says too little to stand as evidence, so the finding is dropped.
 */
export const QUOTE_PREFIX_CHARS = 80;

/** The share of a value's words that must be on the page. */
export const WORD_COVERAGE = {
  /** Scalars: a short paraphrase that keeps the page's words passes, an invented name does not. */
  text: 0.8,
  /** Origin stories, descriptions, bios, answers: summaries of the page in the model's words. */
  longText: 0.7,
  /** The dedupe key of a list item (a name, a question, a segment), in the quote or on the page. */
  itemKey: 0.75,
} as const;

/** Fields whose value is a choice from a fixed list, not a fact from the page: the quote is checked, the value is not. */
const CLASSIFICATION_FIELDS = new Set(["business_type"]);

/**
 * Lowercase, straight quotes, plain hyphens for en and em dashes, plain spaces
 * for non-breaking spaces, all whitespace collapsed to single spaces, trimmed.
 */
export function normalizeForMatch(s: string): string {
  return straightenText(s).toLowerCase();
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export interface VerifiedQuote {
  /** The text that is on the page: the quote as given, or its longest leading run of words that is on the page. */
  text: string;
  /** True when only a leading part of the quote is on the page. */
  partial: boolean;
}

function stripWrapping(s: string): string {
  return s
    .replace(/^["'(\[]+/, "")
    .replace(/["')\].,;:!?]+$/, "")
    .trim();
}

/**
 * The part of a quote that is on the page. The whole quote (or the quote
 * without wrapping quote marks and trailing punctuation) when it is there;
 * otherwise its longest leading run of words that is, if that run has at least
 * QUOTE_PREFIX_CHARS characters; otherwise null. Takes already-normalized page text.
 */
export function verifiedQuote(quote: string, normalizedPage: string): VerifiedQuote | null {
  const straight = straightenText(quote);
  if (!straight || !normalizedPage) return null;
  if (normalizedPage.includes(straight.toLowerCase())) return { text: quote.trim(), partial: false };
  const stripped = stripWrapping(straight);
  if (!stripped) return null;
  if (normalizedPage.includes(stripped.toLowerCase())) return { text: stripped, partial: false };

  // A leading run of words that is on the page means every shorter one is too,
  // so the longest one is found by binary search on the word count.
  const words = stripped.split(" ");
  let lo = 0;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (normalizedPage.includes(words.slice(0, mid).join(" ").toLowerCase())) lo = mid;
    else hi = mid - 1;
  }
  const prefix = words
    .slice(0, lo)
    .join(" ")
    .replace(/[\s,;:-]+$/, "");
  return prefix.length >= QUOTE_PREFIX_CHARS ? { text: prefix, partial: true } : null;
}

/** True when the whole quote is in the already-normalized page text. */
export function quoteMatches(quote: string, normalizedPage: string): boolean {
  return verifiedQuote(quote, normalizedPage)?.partial === false;
}

export function verifyQuote(quote: string, pageText: string): boolean {
  return quoteMatches(quote, normalizeForMatch(pageText));
}

// ---------------------------------------------------------------------------
// What a text says: numbers, words, months
// ---------------------------------------------------------------------------

interface TextIndex {
  /** Lowercase, straightened. */
  text: string;
  /** Numbers as compared (see numbersOf). */
  numbers: Set<string>;
  /** Digit runs in order, as written, for phone numbers. */
  digitRuns: string[];
  /** Word stems. */
  stems: Set<string>;
  /** Months named next to a number ("February 7", "7 Feb"). */
  months: Set<number>;
}

/**
 * The numbers in normalized text, as compared: "25,000" is 25000, "9:00" is 9
 * (so "9:00 AM" meets "9 am"), and leading zeros are dropped ("07" is 7).
 */
function numbersOf(normalized: string): string[] {
  const text = normalized.replace(/(\d{1,2}):00(?!\d)/g, "$1");
  return (text.match(/\d{1,3}(?:,\d{3})+(?!\d)|\d+/g) ?? []).map((n) => n.replace(/,/g, "").replace(/^0+(?=\d)/, ""));
}

const UNITS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
  "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const NUMBER_WORD = new RegExp(`\\b(?:(${TENS.slice(2).join("|")})(?:-(${UNITS.slice(1, 10).join("|")}))?|(${UNITS.join("|")}))\\b`, "g");

/**
 * The numbers a text spells out under one hundred ("fourteen", "twenty-five"),
 * so a value that writes "14 therapists" meets a page that says "Fourteen therapists".
 */
function spelledNumbersOf(normalized: string): string[] {
  const out: string[] = [];
  for (const m of normalized.matchAll(NUMBER_WORD)) {
    if (m[3]) out.push(String(UNITS.indexOf(m[3])));
    else out.push(String(TENS.indexOf(m[1]) * 10 + (m[2] ? UNITS.indexOf(m[2]) : 0)));
  }
  return out;
}

function wordsOf(normalized: string): string[] {
  return normalized.match(/\p{L}+/gu) ?? [];
}

/** A crude singular, applied the same way to values and pages, so "counsellors" meets "counsellor". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

const STOPWORDS = new Set([
  "about", "also", "been", "both", "does", "each", "even", "from", "have", "here", "into", "just",
  "like", "many", "more", "most", "much", "must", "only", "other", "ours", "over", "same", "since",
  "some", "such", "than", "that", "their", "them", "then", "there", "these", "they", "this", "those",
  "very", "were", "what", "when", "where", "which", "while", "will", "with", "would", "your", "yours",
]);

/** The words of a value worth checking: four letters or more and not a stopword; failing that, any word of two or more. */
function contentStems(normalized: string): string[] {
  const words = wordsOf(normalized).filter((w) => !STOPWORDS.has(w));
  const long = words.filter((w) => w.length >= 4);
  return (long.length ? long : words.filter((w) => w.length >= 2)).map(stem);
}

const MONTH_NUMBERS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_NAMES = Object.keys(MONTH_NUMBERS).join("|");
/** A month name next to a number, so "you may book" is not May: "February 7", "Feb. 2018", "7 February", "7th of Feb". */
const MONTH_NEAR_NUMBER = new RegExp(
  `\\b(${MONTH_NAMES})\\b\\.?,?\\s*\\d|\\d(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAMES})\\b`,
  "g",
);

function monthsOf(normalized: string): Set<number> {
  const months = new Set<number>();
  for (const m of normalized.matchAll(MONTH_NEAR_NUMBER)) {
    const name = m[1] ?? m[2];
    if (name && MONTH_NUMBERS[name]) months.add(MONTH_NUMBERS[name]);
  }
  return months;
}

function indexText(normalized: string): TextIndex {
  return {
    text: normalized,
    // Values are read for digits only; the text they are checked against counts spelled-out numbers too.
    numbers: new Set([...numbersOf(normalized), ...spelledNumbersOf(normalized)]),
    digitRuns: normalized.match(/\d+/g) ?? [],
    stems: new Set(wordsOf(normalized).map(stem)),
    months: monthsOf(normalized),
  };
}

// ---------------------------------------------------------------------------
// Value checks. Each returns why the value is not supported, or null.
// ---------------------------------------------------------------------------

function numbersReason(normalizedValue: string, ix: TextIndex, where: string): string | null {
  const missing = numbersOf(normalizedValue).find((n) => !ix.numbers.has(n));
  return missing === undefined ? null : `${missing} is not ${where}`;
}

function wordsReason(stems: string[], min: number, sources: TextIndex[], where: string): string | null {
  if (!stems.length) return null;
  const found = stems.filter((s) => sources.some((ix) => ix.stems.has(s))).length;
  return found / stems.length >= min ? null : `only ${found} of ${stems.length} words are ${where}`;
}

/** Short text: every number in the quote, most of the words on the page. */
function textReason(value: string, quote: TextIndex, page: TextIndex): string | null {
  const v = normalizeForMatch(value);
  return numbersReason(v, quote, "in the quote") ?? wordsReason(contentStems(v), WORD_COVERAGE.text, [page, quote], "on the page");
}

/** A summary in the model's words: its numbers and most of its words on the page, not necessarily in the quote. */
function longTextReason(value: string, page: TextIndex): string | null {
  const v = normalizeForMatch(value);
  return numbersReason(v, page, "on the page") ?? wordsReason(contentStems(v), WORD_COVERAGE.longText, [page], "on the page");
}

/** True when the digits appear in the runs, starting where one run starts and ending where one ends. */
function digitsInOrder(digits: string, runs: string[]): boolean {
  const joined = runs.join("");
  const bounds = new Set<number>([0]);
  let at = 0;
  for (const run of runs) {
    at += run.length;
    bounds.add(at);
  }
  for (let i = joined.indexOf(digits); i >= 0; i = joined.indexOf(digits, i + 1)) {
    if (bounds.has(i) && bounds.has(i + digits.length)) return true;
  }
  return false;
}

/** The number's digits, punctuation and a leading country code 1 aside, in the quote; an extension too. */
function phoneReason(value: string, quote: TextIndex): string | null {
  const digits = normalizePhone(value);
  if (!digits) return "the phone number has no digits";
  if (!digitsInOrder(digits, quote.digitRuns)) return `the number ${value} is not in the quote`;
  const extension = value.match(/(?:ext\.?|extension|x|#)\s*(\d{1,6})\s*$/i)?.[1];
  if (extension && !quote.numbers.has(extension.replace(/^0+(?=\d)/, ""))) {
    return `extension ${extension} is not in the quote`;
  }
  return null;
}

const ISO_DATE = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?\b/;
const NUMERIC_DATE = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;

/**
 * The year and the day must be in the quote. The month may be a word there
 * ("February 7, 2018" supports "2018-02-07"), so a month number is not
 * required, but a month the quote names must be the value's month.
 */
function dateReason(value: string, quote: TextIndex): string | null {
  const v = normalizeForMatch(value);
  const year = yearOf(v);
  if (!year) return numbersReason(v, quote, "in the quote");
  if (!quote.numbers.has(year)) return `the year ${year} is not in the quote`;

  const iso = v.match(ISO_DATE);
  const valueMonths = iso ? new Set([Number(iso[2])]) : monthsOf(v);
  if (valueMonths.size && quote.months.size && ![...valueMonths].some((m) => quote.months.has(m))) {
    return "the month is not the one the quote names";
  }

  const rest = numbersOf(v);
  rest.splice(rest.indexOf(year), 1);
  let isoMonth = iso ? String(Number(iso[2])) : null;
  let numericMonth = !iso && NUMERIC_DATE.test(v);
  for (const n of rest) {
    if (quote.numbers.has(n)) continue;
    if (isoMonth !== null && n === isoMonth) {
      isoMonth = null;
      continue;
    }
    if (numericMonth && Number(n) >= 1 && Number(n) <= 12) {
      numericMonth = false;
      continue;
    }
    return `${n} is not in the quote`;
  }
  return null;
}

/**
 * True when the text shows the link: the address without its scheme and www,
 * or, for a social profile, its handle ("@legiitofficial" for youtube.com/@LegiitOfficial).
 */
function linkShown(value: string, text: string): boolean {
  const link = normalizeUrl(value);
  if (!link) return false;
  if (text.includes(link)) return true;
  const platform = platformFromUrl(value);
  if (!platform || platform === "website") return false;
  const path = link.split(/[?#]/)[0].split("/").filter(Boolean).slice(1);
  const handle = (path[path.length - 1] ?? "").replace(/^@/, "");
  return handle.length >= 3 && text.includes(handle);
}

function linkReason(value: string, quote: TextIndex, page: TextIndex): string | null {
  return (
    numbersReason(normalizeForMatch(value), quote, "in the quote") ??
    (linkShown(value, quote.text) || linkShown(value, page.text) ? null : "the link is not on the page")
  );
}

/**
 * Every number of every part in the quote. Words are read from the line, the
 * street, and the city only: pages abbreviate the region and leave out the
 * country ("BC" for British Columbia), and the model may write them out.
 */
function addressReason(value: FactValue, quote: TextIndex, page: TextIndex): string | null {
  const a: AddressValue =
    typeof value === "string" ? { text: value } : value && !Array.isArray(value) ? value : {};
  const parts = [a.text, a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry];
  const all = parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).join(" ");
  if (!all) return "the address is empty";
  const words = [a.text, a.streetAddress, a.addressLocality].filter(Boolean).join(" ");
  return (
    numbersReason(normalizeForMatch(all), quote, "in the quote") ??
    wordsReason(contentStems(normalizeForMatch(words)), WORD_COVERAGE.text, [page, quote], "on the page")
  );
}

function scalarText(value: FactValue): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.flatMap((item) => Object.values(item).filter((v): v is string => !!v)).join(", ");
  return value?.text?.trim() ?? "";
}

function scalarReason(field: TemplateField | undefined, value: FactValue, quote: TextIndex, page: TextIndex): string | null {
  const type = field?.type ?? "text";
  if (type === "address" || (value !== null && typeof value === "object" && !Array.isArray(value))) {
    return addressReason(value, quote, page);
  }
  const text = scalarText(value);
  if (!text) return "the value is empty";
  switch (type) {
    case "phone":
      return phoneReason(text, quote);
    case "date":
      return dateReason(text, quote);
    case "url":
      return linkReason(text, quote, page);
    case "long_text":
      return longTextReason(text, page);
    default:
      return textReason(text, quote, page);
  }
}

function itemKeyOf(field: TemplateField | undefined, item: ListItem): string {
  if (field?.dedupeKey) return field.dedupeKey;
  if (field?.itemKind === "person") return "name";
  if (field?.itemKind === "social") return "url";
  return field?.itemShape?.[0]?.key ?? Object.keys(item)[0] ?? "";
}

/** The item's identity (a name, a question, a profile link) must be in the quote or on the page. */
function identityReason(field: TemplateField | undefined, type: string | undefined, raw: string, quote: TextIndex, page: TextIndex): string | null {
  if (type === "url") return linkShown(raw, quote.text) || linkShown(raw, page.text) ? null : "the link is not on the page";
  const stems =
    field?.itemKind === "person"
      ? wordsOf(personNameKey(raw))
          .filter((w) => w.length >= 2)
          .map(stem)
      : contentStems(normalizeForMatch(raw));
  return wordsReason(stems, WORD_COVERAGE.itemKey, [quote, page], "in the quote or on the page");
}

/**
 * One list item, key by key. Numbers in a long_text key (a description, a bio)
 * must be on the page and most of its words too; numbers in any other key (a
 * price, a year, credentials) must be in the quote. The dedupe key must also
 * name something the quote or the page names. A failing dedupe or required
 * key fails the item; a failing optional key is left out of it.
 */
function checkItem(
  field: TemplateField | undefined,
  item: ListItem,
  quote: TextIndex,
  page: TextIndex,
): { item: ListItem; changed: boolean; reason: string | null } {
  const identity = itemKeyOf(field, item);
  const kept: ListItem = {};
  let changed = false;
  for (const [key, raw] of Object.entries(item)) {
    if (typeof raw !== "string") continue;
    if (!raw.trim()) {
      kept[key] = raw;
      continue;
    }
    const shape = field?.itemShape?.find((s) => s.key === key);
    let reason =
      shape?.type === "long_text" ? longTextReason(raw, page) : numbersReason(normalizeForMatch(raw), quote, "in the quote");
    if (!reason && key === identity) reason = identityReason(field, shape?.type, raw, quote, page);
    if (reason) {
      if (key === identity || shape?.required) return { item, changed: false, reason: `${key}: ${reason}` };
      changed = true;
      continue;
    }
    kept[key] = raw;
  }
  return changed ? { item: kept, changed, reason: null } : { item, changed, reason: null };
}

function listReason(
  field: TemplateField | undefined,
  value: FactValue,
  quote: TextIndex,
  page: TextIndex,
): { value: FactValue; reason: string | null } {
  let items: ListItem[];
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string" && value.trim()) items = [{ [itemKeyOf(field, {}) || "name"]: value.trim() }];
  else return { value, reason: "the item is empty" };
  if (!items.length) return { value, reason: "the item is empty" };

  let changed = !Array.isArray(value);
  const out: ListItem[] = [];
  for (const item of items) {
    const checked = checkItem(field, item, quote, page);
    if (checked.reason) return { value, reason: checked.reason };
    changed ||= checked.changed;
    out.push(checked.item);
  }
  return { value: changed ? out : value, reason: null };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

type Verdict = { finding: Finding } | { reason: string };

function verifyFinding(finding: Finding, page: TextIndex, field: TemplateField | undefined): Verdict {
  const verified = verifiedQuote(finding.quote, page.text);
  if (!verified) return { reason: "the quote is not on the page" };
  const quote = indexText(normalizeForMatch(verified.text));

  let value = finding.value;
  if (!CLASSIFICATION_FIELDS.has(finding.fieldId)) {
    if (field?.type === "list" || (!field && Array.isArray(value))) {
      const checked = listReason(field, value, quote, page);
      if (checked.reason) return { reason: checked.reason };
      value = checked.value;
    } else {
      const reason = scalarReason(field, value, quote, page);
      if (reason) return { reason };
    }
  }

  if (value === finding.value && verified.text === finding.quote) return { finding };
  return { finding: { ...finding, quote: verified.text, value } };
}

export interface VerifyResult {
  /** Findings that passed, with the verified part of the quote as their quote. */
  kept: Finding[];
  /** Model findings that failed. */
  dropped: Finding[];
  /** Why each was dropped: reasons[i] is for dropped[i]. */
  reasons: string[];
}

/**
 * Splits findings into the ones whose quote is on the page and whose value
 * that quote supports, and the ones that are not. Findings that did not come
 * from the model (JSON-LD, links, images, meta) carry the raw value as their
 * quote and are always kept. The spec gives each field's type; a field it
 * does not know is checked as text.
 */
export function verifyFindings(findings: Finding[], pageText: string, spec: TemplateSpec = ABOUT_V1): VerifyResult {
  const page = indexText(normalizeForMatch(pageText));
  const fields = new Map(spec.fields.map((f) => [f.id, f]));
  const kept: Finding[] = [];
  const dropped: Finding[] = [];
  const reasons: string[] = [];
  for (const finding of findings) {
    if (finding.source !== "page") {
      kept.push(finding);
      continue;
    }
    const verdict = verifyFinding(finding, page, fields.get(finding.fieldId));
    if ("reason" in verdict) {
      dropped.push(finding);
      reasons.push(`${finding.fieldId}: ${verdict.reason}`);
    } else {
      kept.push(verdict.finding);
    }
  }
  return { kept, dropped, reasons };
}
