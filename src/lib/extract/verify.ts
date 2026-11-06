/*
  Quote and value verification. The extractor may not set a field without a
  quote that is a verbatim substring of the page text after whitespace
  normalization, and the value has to be one the quote states: the numbers in
  it must be in the quote and its words on the page. Findings that fail either
  check are dropped and counted, each with a short reason for debugging.
*/
import type { AddressValue, FactValue, Finding, ListItem } from "@/lib/facts/types";
import { ABOUT_V1 } from "@/templates/about-v1";
import type { ListItemShape, TemplateField, TemplateSpec } from "@/templates/types";
import {
  besidesDays,
  clockReadings,
  clockTimesIn,
  dayName,
  datesIn,
  daysNamed,
  normalizePhone,
  normalizeUrl,
  personNameKey,
  platformFromUrl,
  straightenText,
  yearOf,
} from "./normalize";

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
  /** A key the model words itself (wording "summary"): a policy's name, a claim, a segment. */
  summary: 0.5,
  /** A short heading's item and its quote: the share of either's words the other must have (see headingReason). */
  heading: 0.5,
} as const;

/**
 * A summary key this short (content words) is a label. A heading label
 * ("Payment", "Cancellation") needs none of its words on the page; any other
 * ("Veterans", "Fully insured") needs one.
 */
const LABEL_MAX_WORDS = 2;

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
  /** Tokens as codes are written, periods dropped: "M.Ed" is "med", "DipAT" is "dipat". */
  codes: Set<string>;
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

/** A code as written: "MSW", "M.Ed", "RCC-S". */
const CODE = /[\p{L}\p{N}]+(?:[.'-][\p{L}\p{N}]+)*/gu;

/** A code as compared: lowercase, periods dropped ("M.Ed" and "MEd" are "med"). */
function codeKey(code: string): string {
  return code.toLowerCase().replace(/\./g, "");
}

function codesOf(normalized: string): string[] {
  return (normalized.match(CODE) ?? []).map(codeKey);
}

function indexText(normalized: string): TextIndex {
  return {
    text: normalized,
    // Values are read for digits only; the text they are checked against counts spelled-out numbers too.
    numbers: new Set([...numbersOf(normalized), ...spelledNumbersOf(normalized)]),
    digitRuns: normalized.match(/\d+/g) ?? [],
    stems: new Set(wordsOf(normalized).map(stem)),
    codes: new Set(codesOf(normalized)),
  };
}

// ---------------------------------------------------------------------------
// Value checks. Each returns why the value is not supported, or null.
// ---------------------------------------------------------------------------

function numbersReason(normalizedValue: string, ix: TextIndex, where: string): string | null {
  const missing = numbersOf(normalizedValue).find((n) => !ix.numbers.has(n));
  return missing === undefined ? null : `${missing} is not ${where}`;
}

function wordsReason(stems: string[], min: number, sources: Pick<TextIndex, "stems">[], where: string): string | null {
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

type DateCheck = { value: string } | { reason: string };

/**
 * The year must be in the quote, and any month and day the value gives must
 * be ones the quote states: "February 7, 2018" supports "2018-02-07" and
 * "02/07/2018", and nothing in "the spring of 2018" supports "2018-03". A
 * numeric date passes when one reading (month first or day first) is a date
 * the quote states. A value that says more than its quote is cut back to what
 * the quote does state, the year and month or the year alone, because the
 * year is still a fact the page gives.
 */
function checkDate(value: string, quote: TextIndex): DateCheck {
  const v = normalizeForMatch(value);
  const year = yearOf(v);
  if (!year) {
    const reason = numbersReason(v, quote, "in the quote");
    return reason ? { reason } : { value };
  }
  if (!quote.numbers.has(year)) return { reason: `the year ${year} is not in the quote` };

  const readings = datesIn(v);
  if (!readings.length) {
    // A year with words around it ("since 2018"): any other number must be in the quote too.
    const rest = numbersOf(v.replace(year, " "));
    return rest.every((n) => quote.numbers.has(n)) ? { value } : { value: year };
  }
  const stated = datesIn(quote.text);
  let month: number | null = null;
  for (const r of readings) {
    const sameMonth = stated.filter((s) => s.month === r.month);
    if (!sameMonth.length) continue;
    const day = r.day;
    if (day === null || sameMonth.some((s) => s.day === day || (s.day === null && quote.numbers.has(String(day))))) {
      return { value };
    }
    month ??= r.month;
  }
  return { value: month === null ? year : `${year}-${String(month).padStart(2, "0")}` };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What may follow the end of an address or handle: not more of it ("legiitofficial" after "legiit", ".com" after a name). */
const ADDRESS_END = "(?![a-z0-9_]|[.-][a-z0-9])";

/** True when the text has the address, starting and ending where the address does: "facebook.com/legiitofficial" does not show "facebook.com/legiit". */
function addressShown(link: string, text: string): boolean {
  return new RegExp(`(?<![a-z0-9-])${escapeRegExp(link)}${ADDRESS_END}`).test(text);
}

/**
 * True when the text shows a profile's handle as a handle: "@cmwlegiit", or
 * "/legiitofficial" in an address. A word that happens to equal the handle
 * does not count ("Legiit" the business, "Chris" the person), nor does the
 * handle inside a longer word or a domain ("acme-roofing.example").
 */
function handleShown(handle: string, text: string): boolean {
  return new RegExp(`[@/]${escapeRegExp(handle)}${ADDRESS_END}`).test(text);
}

/**
 * True when the link is shown: its address (without scheme and www) in the
 * quote or on the page, or, for a social profile, its handle in the quote
 * ("@legiitofficial" for youtube.com/@LegiitOfficial). A handle the model
 * builds from a name is not shown; the profile's real link, when the page
 * has one, arrives with the page's links.
 */
function linkShown(value: string, quote: TextIndex, page: TextIndex): boolean {
  const link = normalizeUrl(value);
  if (!link) return false;
  if (addressShown(link, quote.text) || addressShown(link, page.text)) return true;
  const platform = platformFromUrl(value);
  if (!platform || platform === "website") return false;
  const path = link.split(/[?#]/)[0].split("/").filter(Boolean).slice(1);
  const handle = (path[path.length - 1] ?? "").replace(/^@/, "");
  return handle.length >= 3 && handleShown(handle, quote.text);
}

function linkReason(value: string, quote: TextIndex, page: TextIndex): string | null {
  return (
    numbersReason(normalizeForMatch(value), quote, "in the quote") ??
    (linkShown(value, quote, page) ? null : "the link is not on the page")
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
    case "date": {
      const checked = checkDate(text, quote);
      return "reason" in checked ? checked.reason : null;
    }
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

interface ItemContext {
  field: TemplateField | undefined;
  item: ListItem;
  /** The dedupe key: a name, a question, a profile link. */
  identity: string;
  quote: TextIndex;
  page: TextIndex;
  /** The page the finding was read from. The extractor is told it, so a link to it is not a guess. */
  pageUrl: string;
}

/** Every code ("MSW, RSW, RCC") on the page as the page writes it: an invented credential is a false claim. */
function codesReason(value: string, page: TextIndex): string | null {
  for (const code of straightenText(value).match(CODE) ?? []) {
    if (!page.codes.has(codeKey(code))) return `${code} is not on the page`;
  }
  return null;
}

const INITIALS_SKIP = new Set(["of", "and", "the", "for", "in"]);

/**
 * The words of the value's phrases that spell out a code the quote gives:
 * "Registered Clinical Counsellor" for the RCC in "Swetha Ranasuriya, MA, RCC".
 */
function spelledOutStems(normalizedValue: string, quote: TextIndex): Set<string> {
  const out = new Set<string>();
  for (const phrase of normalizedValue.split(/[,;()/]|\s-\s/)) {
    const words = wordsOf(phrase).filter((w) => !INITIALS_SKIP.has(w));
    if (words.length < 2 || !quote.codes.has(words.map((w) => w[0]).join(""))) continue;
    for (const w of words) out.add(stem(w));
  }
  return out;
}

/**
 * Short text in an item (a role, a title, an issuer, notes): the scalar text
 * check, with a phrase that spells out a code in the quote counted as on the page.
 */
function itemTextReason(value: string, quote: TextIndex, page: TextIndex): string | null {
  const v = normalizeForMatch(value);
  return (
    numbersReason(v, quote, "in the quote") ??
    wordsReason(contentStems(v), WORD_COVERAGE.text, [page, quote, { stems: spelledOutStems(v, quote) }], "on the page")
  );
}

/** Numbers and words both in the quote. "Free" is on most pages, so a price has to be in the quote that gives it. */
function quotedReason(value: string, quote: TextIndex): string | null {
  const v = normalizeForMatch(value);
  return numbersReason(v, quote, "in the quote") ?? wordsReason(contentStems(v), WORD_COVERAGE.text, [quote], "in the quote");
}

/**
 * Opening days compared as days: every day the value names must be a day the
 * quote names ("Mon - Thu", "Weekdays"), or the page when the quote names none.
 * Anything else the value says needs its words in the quote or on the page.
 */
function daysReason(value: string, days: Set<number>, quote: TextIndex, page: TextIndex): string | null {
  const inQuote = daysNamed(quote.text);
  const shown = inQuote.size ? inQuote : daysNamed(page.text);
  const missing = [...days].find((d) => !shown.has(d));
  if (missing !== undefined) return `${dayName(missing)} is not ${inQuote.size ? "in the quote" : "on the page"}`;
  return wordsReason(contentStems(besidesDays(value)), WORD_COVERAGE.itemKey, [quote, page], "in the quote or on the page");
}

/** A clock time compared in minutes: "5:00 PM" is in a quote that says "17:00", "9 AM" in one that says "9am". */
function timeReason(value: string, readings: number[], quote: TextIndex): string | null {
  const shown = clockTimesIn(quote.text);
  return readings.some((t) => shown.has(t)) ? null : `${value} is not in the quote`;
}

/** A link in an item: the address of the page the item was read from, or a link the quote or the page shows. */
function itemLinkReason(value: string, ctx: ItemContext): string | null {
  const link = normalizeUrl(value);
  if (link && link === normalizeUrl(ctx.pageUrl)) return null;
  return linkReason(value, ctx.quote, ctx.page);
}

/**
 * A heading of one or two words the model writes ("Payment" over the card
 * policy) needs none of its words on the page, but the quote and the item
 * have to be about the same thing: half the quote's words are the item's, or
 * half the item's words (its heading's too) are in the quote. A heading over a
 * quote about something else ("Sliding scale" quoted from a line about the
 * therapists) is not evidence of anything.
 */
function headingReason(item: ListItem, quote: TextIndex): string | null {
  const words = Object.values(item).filter((v): v is string => typeof v === "string");
  const itemStems = contentStems(normalizeForMatch(words.join(" ")));
  const quoteStems = contentStems(quote.text);
  if (!quoteStems.length || !itemStems.length) return null;
  const itemSet = new Set(itemStems);
  const quoteShare = quoteStems.filter((s) => itemSet.has(s)).length / quoteStems.length;
  const itemShare = itemStems.filter((s) => quote.stems.has(s)).length / itemStems.length;
  return Math.max(quoteShare, itemShare) >= WORD_COVERAGE.heading ? null : "the quote is not about this item";
}

/**
 * The item's identity (a name, a question, a profile link) must be in the
 * quote or on the page. A key the model words itself is held to less: a label
 * of one or two words needs one of them in the quote or on the page ("Veterans"
 * on a page that never mentions veterans fails), a heading needs a quote about
 * its item (see headingReason), and a longer key needs half its words.
 */
function identityReason(ctx: ItemContext, shape: ListItemShape | undefined, raw: string): string | null {
  const { field, quote, page } = ctx;
  if (shape?.wording === "summary") {
    const stems = contentStems(normalizeForMatch(raw));
    if (stems.length <= LABEL_MAX_WORDS) {
      if (shape.check === "heading") return headingReason(ctx.item, quote);
      if (!stems.length || stems.some((s) => quote.stems.has(s) || page.stems.has(s))) return null;
      return "none of its words are in the quote or on the page";
    }
    return wordsReason(stems, WORD_COVERAGE.summary, [quote, page], "in the quote or on the page");
  }
  const stems =
    field?.itemKind === "person"
      ? wordsOf(personNameKey(raw))
          .filter((w) => w.length >= 2)
          .map(stem)
      : contentStems(normalizeForMatch(raw));
  return wordsReason(stems, WORD_COVERAGE.itemKey, [quote, page], "in the quote or on the page");
}

/**
 * Why one key of an item is not supported, or null. Long text (a description,
 * a bio) is read against the page; a link must be shown; days and times are
 * compared as days and minutes; codes must each be on the page; a price must
 * be in its quote; a value the model picks has only its numbers checked. Any
 * other key is checked as short text (its numbers in the quote, most of its
 * words in the quote or on the page), and the identity as above.
 */
function keyReason(ctx: ItemContext, key: string, raw: string): string | null {
  const shape = ctx.field?.itemShape?.find((s) => s.key === key);
  const { quote, page } = ctx;
  if (shape?.type === "long_text") return longTextReason(raw, page);
  if (shape?.type === "url") return itemLinkReason(raw, ctx);
  const numbers = () => numbersReason(normalizeForMatch(raw), quote, "in the quote");
  switch (shape?.check) {
    case "days": {
      const days = daysNamed(raw);
      if (days.size) return daysReason(raw, days, quote, page);
      break;
    }
    case "time": {
      const readings = clockReadings(raw);
      if (readings) return timeReason(raw, readings, quote);
      break;
    }
    case "choice":
      return numbers();
    case "codes":
      return numbers() ?? codesReason(raw, page);
    case "quoted":
      return quotedReason(raw, quote);
  }
  if (key === ctx.identity) return numbers() ?? identityReason(ctx, shape, raw);
  return itemTextReason(raw, quote, page);
}

/**
 * One list item, key by key (see keyReason). A failing dedupe or required key
 * fails the item; a failing optional key is left out of it.
 */
function checkItem(
  field: TemplateField | undefined,
  item: ListItem,
  quote: TextIndex,
  page: TextIndex,
  pageUrl: string,
): { item: ListItem; changed: boolean; reason: string | null } {
  const ctx: ItemContext = { field, item, identity: itemKeyOf(field, item), quote, page, pageUrl };
  const kept: ListItem = {};
  let changed = false;
  for (const [key, raw] of Object.entries(item)) {
    if (typeof raw !== "string") continue;
    if (!raw.trim()) {
      kept[key] = raw;
      continue;
    }
    const reason = keyReason(ctx, key, raw);
    if (reason) {
      const required = field?.itemShape?.find((s) => s.key === key)?.required;
      if (key === ctx.identity || required) return { item, changed: false, reason: `${key}: ${reason}` };
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
  pageUrl: string,
): { value: FactValue; reason: string | null } {
  let items: ListItem[];
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string" && value.trim()) items = [{ [itemKeyOf(field, {}) || "name"]: value.trim() }];
  else return { value, reason: "the item is empty" };
  if (!items.length) return { value, reason: "the item is empty" };

  let changed = !Array.isArray(value);
  const out: ListItem[] = [];
  for (const item of items) {
    const checked = checkItem(field, item, quote, page, pageUrl);
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
      const checked = listReason(field, value, quote, page, finding.url);
      if (checked.reason) return { reason: checked.reason };
      value = checked.value;
    } else if (field?.type === "date" && typeof value === "string" && value.trim()) {
      // A date that says more than its quote is cut back to the part the quote states.
      const checked = checkDate(value.trim(), quote);
      if ("reason" in checked) return { reason: checked.reason };
      if (checked.value !== value.trim()) value = checked.value;
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
