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

/**
 * Same person when the name keys match, differ by a small typo (distance 2 or
 * less on keys longer than 5 characters), or one is the other's first and last
 * name with the middle name or initial left out.
 */
export function samePerson(a: string, b: string): boolean {
  const ka = personNameKey(a);
  const kb = personNameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (Math.min(ka.length, kb.length) > 5 && levenshtein(ka, kb) <= 2) return true;
  const ta = ka.split(" ");
  const tb = kb.split(" ");
  if (ta.length >= 2 && tb.length >= 2 && ta.length !== tb.length) {
    const [shorter, longer] = ta.length < tb.length ? [ta, tb] : [tb, ta];
    if (shorter.length === 2 && shorter[0] === longer[0] && shorter[1] === longer[longer.length - 1]) {
      return true;
    }
  }
  return false;
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
