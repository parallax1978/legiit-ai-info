/*
  Link classification: tel and mailto normalization, social, maps, and review
  hosts, and share links to ignore. Pure.
*/

export type LinkClass =
  | { kind: "social"; platform: string }
  | { kind: "maps" }
  | { kind: "reviews"; site: string }
  | null;

/** "tel:+1 (604) 533-9163" -> "+16045339163". Null when too short to be a number. */
export function normalizeTel(href: string): string | null {
  const raw = decodeURIComponentSafe(href.replace(/^tel:/i, "")).trim();
  const plus = raw.startsWith("+") ? "+" : "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${plus}${digits}`;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

/** "mailto:Help@Example.com?subject=Hi" -> ["help@example.com"]. */
export function normalizeMailto(href: string): string[] {
  const raw = decodeURIComponentSafe(href.replace(/^mailto:/i, "")).split("?")[0];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL_RE.test(s));
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Host without a leading "www." or "m.", lowercased. */
function bareHost(u: URL): string {
  return u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
}

function hostIs(host: string, ...domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** A host like "yelp.com", "yelp.ca", "yelp.co.uk". */
function hostIsBrand(host: string, brand: string): boolean {
  return new RegExp(`(^|\\.)${brand}\\.[a-z]{2,3}(\\.[a-z]{2})?$`).test(host);
}

const SHARE_RE =
  /(facebook\.com\/(sharer|share|dialog\/share)|twitter\.com\/(intent|share)|x\.com\/intent|linkedin\.com\/(share|shareArticle|sharing)|pinterest\.[a-z.]+\/pin\/create|api\.whatsapp\.com\/send|wa\.me\/\?text|t\.me\/share|telegram\.me\/share|reddit\.com\/submit|tumblr\.com\/share|plus\.google\.com\/share|facebook\.com\/plugins)/i;

/** Share and intent links that only post the current page somewhere. */
export function isShareLink(url: string): boolean {
  return SHARE_RE.test(url);
}

const REVIEW_SITES: { site: string; test: (host: string) => boolean }[] = [
  { site: "yelp", test: (h) => hostIsBrand(h, "yelp") },
  { site: "trustpilot", test: (h) => hostIsBrand(h, "trustpilot") },
  { site: "g2", test: (h) => hostIs(h, "g2.com") },
  { site: "capterra", test: (h) => hostIsBrand(h, "capterra") },
  { site: "clutch", test: (h) => hostIs(h, "clutch.co") },
  { site: "bbb", test: (h) => hostIs(h, "bbb.org") },
  { site: "glassdoor", test: (h) => hostIsBrand(h, "glassdoor") },
  { site: "tripadvisor", test: (h) => hostIsBrand(h, "tripadvisor") },
  { site: "healthgrades", test: (h) => hostIs(h, "healthgrades.com") },
  { site: "psychologytoday", test: (h) => hostIs(h, "psychologytoday.com") },
  { site: "avvo", test: (h) => hostIs(h, "avvo.com") },
  { site: "houzz", test: (h) => hostIsBrand(h, "houzz") },
  { site: "angi", test: (h) => hostIs(h, "angi.com", "angieslist.com") },
  { site: "zillow", test: (h) => hostIs(h, "zillow.com") },
  { site: "ratemds", test: (h) => hostIs(h, "ratemds.com") },
  { site: "homestars", test: (h) => hostIs(h, "homestars.com") },
  { site: "yellowpages", test: (h) => hostIsBrand(h, "yellowpages") },
  { site: "productreview", test: (h) => hostIs(h, "productreview.com.au") },
  { site: "checkatrade", test: (h) => hostIs(h, "checkatrade.com") },
  { site: "feefo", test: (h) => hostIs(h, "feefo.com") },
  { site: "reviews.io", test: (h) => hostIs(h, "reviews.io", "reviews.co.uk") },
  { site: "goodfirms", test: (h) => hostIs(h, "goodfirms.co") },
  { site: "designrush", test: (h) => hostIs(h, "designrush.com") },
  { site: "zocdoc", test: (h) => hostIs(h, "zocdoc.com") },
  { site: "thumbtack", test: (h) => hostIs(h, "thumbtack.com") },
  { site: "homeadvisor", test: (h) => hostIs(h, "homeadvisor.com") },
  { site: "opentable", test: (h) => hostIsBrand(h, "opentable") },
  { site: "theknot", test: (h) => hostIs(h, "theknot.com") },
  { site: "weddingwire", test: (h) => hostIsBrand(h, "weddingwire") },
  { site: "martindale", test: (h) => hostIs(h, "martindale.com") },
  { site: "lawyers.com", test: (h) => hostIs(h, "lawyers.com") },
];

function socialPlatform(host: string, path: string): string | null {
  if (hostIs(host, "facebook.com", "fb.com", "fb.me")) return "facebook";
  if (hostIs(host, "instagram.com", "instagr.am")) return "instagram";
  if (hostIs(host, "linkedin.com", "lnkd.in")) return "linkedin";
  if (hostIs(host, "youtube.com", "youtu.be")) return "youtube";
  if (hostIs(host, "x.com", "twitter.com")) return "x";
  if (hostIs(host, "tiktok.com")) return "tiktok";
  if (hostIs(host, "threads.net", "threads.com")) return "threads";
  if (hostIsBrand(host, "pinterest") || host === "pin.it") return "pinterest";
  void path;
  return null;
}

function isMapsLink(host: string, path: string): boolean {
  if (host === "maps.app.goo.gl" || host === "g.page" || host === "g.co") return true;
  if (host === "goo.gl" && path.startsWith("/maps")) return true;
  if (/^maps\.google\.[a-z.]+$/.test(host)) return true;
  if (/^google\.[a-z.]+$/.test(host) && /^\/(maps|local)(\/|$)/.test(path)) return true;
  if (host === "search.google.com" && path.startsWith("/local/")) return true;
  if (host === "maps.apple.com") return true;
  if (host === "bing.com" && path.startsWith("/maps")) return true;
  if (host === "waze.com" && /^\/(ul|live-map)/.test(path)) return true;
  return false;
}

/**
 * What an outbound http(s) link points at, or null when it is an ordinary
 * site. Share and intent links return null; check isShareLink first when they
 * must be told apart.
 */
export function classifyLink(url: string): LinkClass {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (isShareLink(url)) return null;

  const host = bareHost(u);
  const path = u.pathname;

  if (isMapsLink(host, path)) return { kind: "maps" };
  const platform = socialPlatform(host, path);
  if (platform) return { kind: "social", platform };
  const review = REVIEW_SITES.find((r) => r.test(host));
  if (review) return { kind: "reviews", site: review.site };
  return null;
}
