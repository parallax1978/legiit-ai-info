/*
  Pure helpers for comparing and de-duplicating extracted values. Nothing here
  touches the network, Next.js, or Supabase, so vitest runs it in node.
*/
import type { AddressValue, FactValue } from "@/lib/facts/types";
import type { FieldType } from "@/templates/types";

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u02BC\u00B4]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g;
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;
const ODD_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Straight quotes, plain hyphens, plain spaces, one space between words, no
 * zero-width characters. Case is kept.
 */
export function straightenText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(/\u2026/g, "...")
    .replace(ODD_SPACES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comparison key for text: lowercase, straight quotes, no wrapping quotes or trailing punctuation. */
export function normalizeText(s: string): string {
  return straightenText(s)
    .toLowerCase()
    .replace(/ & /g, " and ")
    .replace(/^["'(\[]+/, "")
    .replace(/["')\].,;:!?]+$/, "")
    .trim();
}

/** Letters, digits and single spaces only. */
function alnumKey(s: string): string {
  return straightenText(s)
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF]+/g, " ")
    .trim();
}

function lettersOnly(s: string): string {
  return straightenText(s).toLowerCase().replace(/[^a-z]+/g, "");
}

/** Digits only. A trailing extension is dropped, so is the leading 1 of an 11-digit North American number. */
export function normalizePhone(s: string): string {
  const main = s.replace(/\s*(?:ext\.?|extension|x|#)\s*\d{1,6}\s*$/i, "");
  let digits = main.replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

export function normalizeEmail(s: string): string {
  return s.trim().replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
}

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "igsh", "igshid"]);

/** Host without www, no protocol, no trailing slash, no tracking params, no hash. Lowercase throughout. */
export function normalizeUrl(s: string): string {
  const raw = s.trim();
  if (!raw) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const params = new URLSearchParams(u.search);
  for (const key of [...params.keys()]) {
    if (/^utm_/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  const query = params.toString();
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${path}${query ? `?${query}` : ""}`.toLowerCase();
}

const YEAR = /\b(1[89]\d{2}|20\d{2})\b/;

/** The four-digit year when there is one, otherwise the normalized text. */
export function normalizeDate(s: string): string {
  const m = s.match(YEAR);
  return m ? m[1] : normalizeText(s);
}

export function yearOf(s: string): string | null {
  const m = s.match(YEAR);
  return m ? m[1] : null;
}

const MONTH_NUMBERS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH = `(${Object.keys(MONTH_NUMBERS).join("|")})`;
const ORDINAL = "(?:st|nd|rd|th)?";
/** A month name next to a number, so "you may book" is not May. */
const NAMED_DATES = [
  // "February 7", "Feb. 7th"
  { re: new RegExp(`\\b${MONTH}\\b\\.?\\s*(\\d{1,2})${ORDINAL}\\b(?![\\d:])`, "g"), month: 1, day: 2 },
  // "7 February", "7th of Feb"
  { re: new RegExp(`\\b(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH}\\b`, "g"), month: 2, day: 1 },
  // "February 2018", "Feb, 2018", "March of 2018"
  { re: new RegExp(`\\b${MONTH}\\b\\.?,?\\s*(?:of\\s+)?\\d{4}\\b`, "g"), month: 1, day: 0 },
];

export interface DatePart {
  month: number;
  day: number | null;
}

function datePart(month: number, day: number | null): DatePart | null {
  if (!(month >= 1 && month <= 12)) return null;
  if (day !== null && !(day >= 1 && day <= 31)) return null;
  return { month, day };
}

/**
 * The months, with their days, that a text states: "February 7, 2018",
 * "7 Feb", "February 2018" (no day), "2018-02-07", and both readings of a
 * numeric date ("03/07/2018" is March 7 or July 3). A bare year states none.
 */
export function datesIn(text: string): DatePart[] {
  const s = straightenText(text).toLowerCase();
  const out: DatePart[] = [];
  const push = (p: DatePart | null) => {
    if (!p || out.some((o) => o.month === p.month && (o.day === p.day || p.day === null))) return;
    out.push(p);
  };
  for (const m of s.matchAll(/\b\d{4}-(\d{1,2})(?:-(\d{1,2}))?\b/g)) push(datePart(Number(m[1]), m[2] ? Number(m[2]) : null));
  for (const m of s.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](?:\d{4}|\d{2})\b/g)) {
    push(datePart(Number(m[1]), Number(m[2])));
    push(datePart(Number(m[2]), Number(m[1])));
  }
  for (const { re, month, day } of NAMED_DATES) {
    for (const m of s.matchAll(re)) push(datePart(MONTH_NUMBERS[m[month]] ?? 0, day ? Number(m[day]) : null));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Opening hours: days of the week and clock times
// ---------------------------------------------------------------------------

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** A day, a group of days, or every day, as pages write them: "Mon", "Thurs", "Weekdays", "daily", "7 days a week". */
const DAY_WORD =
  /\b(?:(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|(weekdays?)|(weekends?)|(daily|everyday|every day|all week|(?:7|seven) days(?: a week)?))\b\.?/g;
/** What joins the two ends of a run of days: "Mon - Fri", "Monday to Friday", "Monday through Friday". */
const DAY_RANGE = /^\s*(?:-|to|through|thru|till|until)\s*$/;
/** What else a days value may say around its days without saying anything more. */
const DAY_JOINERS = /\b(?:to|through|thru|till|until|and|from|or)\b|[-&,/:;+]/g;

/** The days of the week a text names, Monday 0 to Sunday 6, with runs and groups expanded ("Mon - Thu", "weekdays"). */
export function daysNamed(text: string): Set<number> {
  const s = straightenText(text).toLowerCase();
  const out = new Set<number>();
  let prev: { day: number; end: number } | null = null;
  for (const m of s.matchAll(DAY_WORD)) {
    const at = m.index ?? 0;
    if (m[1]) {
      const day = WEEKDAYS.findIndex((d) => d.startsWith(m[1].slice(0, 3)));
      if (prev && DAY_RANGE.test(s.slice(prev.end, at))) {
        for (let d: number = prev.day; d !== day; d = (d + 1) % 7) out.add(d);
      }
      out.add(day);
      prev = { day, end: at + m[0].length };
      continue;
    }
    const group = m[2] ? [0, 1, 2, 3, 4] : m[3] ? [5, 6] : [0, 1, 2, 3, 4, 5, 6];
    for (const d of group) out.add(d);
    prev = null;
  }
  return out;
}

/** What a days value says besides its days ("Monday to Friday, admin office" leaves "admin office"). */
export function besidesDays(text: string): string {
  return straightenText(text).toLowerCase().replace(DAY_WORD, " ").replace(DAY_JOINERS, " ").replace(/\s+/g, " ").trim();
}

export function dayName(day: number): string {
  const name = WEEKDAYS[day] ?? "";
  return name ? `${name[0].toUpperCase()}${name.slice(1)}` : "";
}

/** Comparison key for a days value: the days as a set, then anything else it says. "Mon - Fri" and "Monday to Friday" share one. */
export function dayKey(value: string): string {
  const days = daysNamed(value);
  if (!days.size) return "";
  const rest = besidesDays(value);
  return `days:${[...days].sort().join("")}${rest ? ` ${rest}` : ""}`;
}

/** Minutes after midnight for an hour and minute, both readings when no am or pm says which half of the day. */
function clockReadingsOf(hour: number, minute: number, meridiem: string | undefined, colon: boolean): number[] {
  if (minute > 59) return [];
  if (meridiem) {
    if (hour < 1 || hour > 12) return [];
    return [((hour % 12) + (meridiem === "p" ? 12 : 0)) * 60 + minute];
  }
  if (hour > 23 || (!colon && (hour < 1 || hour > 12))) return [];
  const asWritten = hour * 60 + minute;
  return hour >= 1 && hour < 12 ? [asWritten, asWritten + 720] : [asWritten];
}

const CLOCK = /(?<![\d:.$])(\d{1,2})(?:[:.](\d{2}))?\s*(?:([ap])\.?\s?m\b\.?)?(?![\d:])/g;

/**
 * The clock times a text states, in minutes after midnight: "9am", "9:00 AM",
 * "9.30am", "17:00", "noon". A time with no am or pm ("9:00", or the 9 and 5
 * of "9-5") counts as both readings.
 */
export function clockTimesIn(text: string): Set<number> {
  const s = straightenText(text).toLowerCase();
  const out = new Set<number>();
  for (const m of s.matchAll(CLOCK)) {
    for (const t of clockReadingsOf(Number(m[1]), m[2] ? Number(m[2]) : 0, m[3], m[2] !== undefined)) out.add(t);
  }
  if (/\bnoon\b/.test(s)) out.add(720);
  if (/\bmidnight\b/.test(s)) out.add(0);
  return out;
}

/** The readings of a time value in minutes after midnight ("5 PM" is 1020), or null when it is not a clock time ("Closed"). */
export function clockReadings(value: string): number[] | null {
  const s = straightenText(value).toLowerCase();
  if (/^(?:12\s*)?noon$/.test(s)) return [720];
  if (/^(?:12\s*)?midnight$/.test(s)) return [0];
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(?:([ap])\.?\s?m\.?)?$/);
  if (!m) return null;
  const readings = clockReadingsOf(Number(m[1]), m[2] ? Number(m[2]) : 0, m[3], m[2] !== undefined);
  return readings.length ? readings : null;
}

/** Comparison key for a time value: its minutes when it names one time ("9 AM", "9:00 AM", and "09:00" share one), else its text. */
export function timeKey(value: string): string {
  const readings = clockReadings(value);
  if (!readings) return "";
  // "9:00" is read as written, as a 24-hour time; a bare "9" could be either.
  return readings.length === 1 || value.includes(":") ? `time:${readings[0]}` : "";
}

export function normalizeNumber(s: string): string {
  return s.replace(/[^\d.]+/g, "");
}

const REGION_CODES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co",
  connecticut: "ct", delaware: "de", districtofcolumbia: "dc", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks",
  kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma",
  michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt",
  nebraska: "ne", nevada: "nv", newhampshire: "nh", newjersey: "nj", newmexico: "nm",
  newyork: "ny", northcarolina: "nc", northdakota: "nd", ohio: "oh", oklahoma: "ok",
  oregon: "or", pennsylvania: "pa", rhodeisland: "ri", southcarolina: "sc", southdakota: "sd",
  tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt", virginia: "va", washington: "wa",
  westvirginia: "wv", wisconsin: "wi", wyoming: "wy",
  alberta: "ab", britishcolumbia: "bc", manitoba: "mb", newbrunswick: "nb",
  newfoundlandandlabrador: "nl", newfoundland: "nl", novascotia: "ns", ontario: "on",
  princeedwardisland: "pe", quebec: "qc", saskatchewan: "sk", northwestterritories: "nt",
  nunavut: "nu", yukon: "yt",
};

const STREET_WORDS: Record<string, string> = {
  avenue: "ave",
  street: "st",
  road: "rd",
  drive: "dr",
  boulevard: "blvd",
  lane: "ln",
  court: "ct",
  place: "pl",
  highway: "hwy",
  parkway: "pkwy",
  suite: "ste",
  floor: "fl",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
};

function streetKey(s: string): string {
  return alnumKey(s)
    .split(" ")
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");
}

/**
 * Comparison key for an address: street, locality, region, and postal code,
 * normalized, or the one-line text when there are no parts. The country is
 * left out because pages often omit it where JSON-LD states it, and the other
 * four parts already pin the place.
 */
export function normalizeAddress(value: AddressValue | string): string {
  if (typeof value === "string") return alnumKey(value);
  const region = value.addressRegion ? lettersOnly(value.addressRegion) : "";
  const parts = [
    streetKey(value.streetAddress ?? ""),
    alnumKey(value.addressLocality ?? ""),
    region ? (REGION_CODES[region] ?? region) : "",
    (value.postalCode ?? "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
  ].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return alnumKey(value.text ?? "");
}

/** The key two findings for one scalar field are grouped by. */
export function normalizeForCompare(fieldType: FieldType, value: FactValue): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    // Lists are merged item by item, not as a whole; this key is only a fallback.
    return value
      .map((item) =>
        Object.values(item)
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .map(normalizeText)
          .join(" "),
      )
      .join(" | ");
  }
  if (typeof value === "object") return normalizeAddress(value);
  switch (fieldType) {
    case "phone":
      return normalizePhone(value);
    case "email":
      return normalizeEmail(value);
    case "url":
      return normalizeUrl(value);
    case "date":
      return normalizeDate(value);
    case "number":
      return normalizeNumber(value);
    case "address":
      return normalizeAddress(value);
    default:
      return normalizeText(value);
  }
}

/** Dedupe key for a list item value (a name, a plan name, a question). */
export function normalizeItemKey(value: string | undefined): string {
  return normalizeText(value ?? "");
}

const HONORIFICS = new Set([
  "dr",
  "mr",
  "ms",
  "mrs",
  "miss",
  "mx",
  "prof",
  "professor",
  "sir",
  "dame",
  "rev",
  "reverend",
  "hon",
]);

/** Lowercase, no honorifics, no credentials after a comma, no initials' periods, one space between tokens. */
export function personNameKey(name: string): string {
  let s = straightenText(name).toLowerCase();
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.split(",")[0];
  s = s.replace(/[.,;:!?"()[\]{}<>/\\|@#$%^&*_+=~`]+/g, " ");
  const tokens = s.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && HONORIFICS.has(tokens[0])) tokens.shift();
  return tokens.join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** True when b is a with two neighbouring letters swapped ("ranasuirya" / "ranasuriya"). */
function swappedNeighbours(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (i >= a.length - 1) return false;
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

/** True when the longer of a and b is the shorter with one letter doubled ("philips" / "phillips"). */
function doubledLetter(a: string, b: string): boolean {
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long.length !== short.length + 1) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  const extra = long[i];
  return (extra === long[i - 1] || extra === long[i + 1]) && short.slice(i) === long.slice(i + 1);
}

/**
 * Two name tokens a typo apart. Tokens under five letters must match exactly
 * (Mark / Mary, Dan / Dana, Jon / Joe are different people). Longer tokens may
 * swap two neighbouring letters or double one. Only a surname of eight letters
 * or more may also differ by one other edit (MacWilliams / McWilliams), because
 * a one-letter change in a shorter name is usually another name (Walker /
 * Walter) and first names come in near pairs (Christina / Christine).
 */
function nameTokensClose(a: string, b: string, surname: boolean): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 5) return false;
  if (swappedNeighbours(a, b) || doubledLetter(a, b)) return true;
  return surname && shorter >= 8 && levenshtein(a, b) <= 1;
}

/**
 * True when one name is the other's first and last name with the middle names
 * or initials left out ("chris walker" / "chris m walker"). Takes name-key tokens.
 */
export function middleNameDropped(a: string[], b: string[]): boolean {
  if (a.length < 2 || b.length < 2 || a.length === b.length) return false;
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return shorter.length === 2 && shorter[0] === longer[0] && shorter[1] === longer[longer.length - 1];
}

/**
 * True when two given names (first name-key tokens) can be one person's:
 * equal, or one is an initial or short form that begins the other ("j" /
 * "jim", "pal" / "palvinder"). Mark and Mary, Djordje and Marija are not.
 */
export function givenNamesCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.startsWith(short);
}

/**
 * Same person when the name keys match, when they have the same number of
 * tokens and exactly one token is a typo of the other (see nameTokensClose), or
 * when one is the other's first and last name with the middle name or initial
 * left out. A first name alone never matches a full name here; the merge
 * decides that case with the profile URL and the page.
 */
export function samePerson(a: string, b: string): boolean {
  const ka = personNameKey(a);
  const kb = personNameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ta = ka.split(" ");
  const tb = kb.split(" ");
  if (ta.length !== tb.length) return middleNameDropped(ta, tb);
  let differing = 0;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) continue;
    differing++;
    const surname = ta.length > 1 && i === ta.length - 1;
    if (differing > 1 || !nameTokensClose(ta[i], tb[i], surname)) return false;
  }
  return true;
}

const PLATFORM_HOSTS: [string, string][] = [
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["fb.me", "facebook"],
  ["instagram.com", "instagram"],
  ["instagr.am", "instagram"],
  ["linkedin.com", "linkedin"],
  ["lnkd.in", "linkedin"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["x.com", "x"],
  ["twitter.com", "x"],
  ["tiktok.com", "tiktok"],
  ["threads.net", "threads"],
  ["threads.com", "threads"],
  ["pin.it", "pinterest"],
  ["g.page", "google"],
  ["g.co", "google"],
  ["maps.app.goo.gl", "google"],
  ["business.google.com", "google"],
  ["maps.google.com", "google"],
];

/**
 * facebook, instagram, linkedin, youtube, x, tiktok, threads, pinterest,
 * google (Maps or Business Profile), website for any other http(s) URL, null
 * when the string is not a URL.
 */
export function platformFromUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  if (!host.includes(".")) return null;
  for (const [h, platform] of PLATFORM_HOSTS) {
    if (host === h || host.endsWith(`.${h}`)) return platform;
  }
  if (/^pinterest\.[a-z.]+$/.test(host)) return "pinterest";
  if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname.startsWith("/maps")) return "google";
  if (/(^|\.)goo\.gl$/.test(host) && u.pathname.startsWith("/maps")) return "google";
  return "website";
}
