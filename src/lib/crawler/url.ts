/*
  URL helpers for the crawler. Pure functions, no network, no server-only
  imports, so vitest runs them in node.
*/

export type RankedUrl = { url: string; rank: number; reason: string };
export type UrlCandidate = {
  url: string;
  text?: string;
  /** The home page links here (its own navigation, footer, or body). */
  fromHome?: boolean;
};

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

/** Query parameters that only track the visitor; dropped when normalizing. */
const TRACKING_PARAM_RE =
  /^(utm_[a-z0-9_]*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|hsa_[a-z0-9_]+|igshid|yclid|twclid|ttclid|srsltid|_ga|_gl|vero_id|oly_enc_id|oly_anon_id|rb_clickid|s_kwcid|_openstat|ref|referrer|source)$/i;

/** Schemes that are never pages. */
const NON_PAGE_SCHEME_RE =
  /^(mailto|tel|sms|fax|callto|skype|whatsapp|javascript|data|blob|ftp|file|about|geo|intent|chrome|vbscript|wa):/i;

/** The host, lowercased, without a trailing dot or IPv6 brackets. */
function cleanHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
}

function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

function isPrivateIpv4(o: number[]): boolean {
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (o[2] === 0 || o[2] === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

export function isIpLiteral(hostname: string): boolean {
  const host = cleanHost(hostname);
  return parseIpv4(host) !== null || host.includes(":");
}

/**
 * The eight 16-bit groups of an IPv6 address, or null when it is not one.
 * Handles "::" compression, a zone suffix ("%eth0"), and an embedded IPv4
 * tail ("::ffff:1.2.3.4"). The WHATWG URL parser rewrites the dotted tail to
 * hex ("::ffff:7f00:1"), so both spellings must classify the same.
 */
export function parseIpv6(input: string): number[] | null {
  let h = input.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!h.includes(":")) return null;
  const tail4 = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (tail4) {
    const v4 = parseIpv4(tail4[2]);
    if (!v4) return null;
    h = `${tail4[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/.test(h)) return null;
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (part: string) => (part ? part.split(":") : []);
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if ([...head, ...tail].some((g) => g.length === 0 || g.length > 4)) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) =>
    parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

function isPrivateIpv6(g: number[]): boolean {
  const v4At = (i: number) => [g[i] >> 8, g[i] & 0xff, g[i + 1] >> 8, g[i + 1] & 0xff];
  const zeroThrough = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroThrough(8)) return true; // ::
  if (zeroThrough(7) && g[7] === 1) return true; // ::1
  if (zeroThrough(5) && g[5] === 0xffff) return isPrivateIpv4(v4At(6)); // ::ffff:a.b.c.d, IPv4-mapped
  if (zeroThrough(4) && g[4] === 0xffff && g[5] === 0) return isPrivateIpv4(v4At(6)); // ::ffff:0:a.b.c.d
  if (zeroThrough(6)) return isPrivateIpv4(v4At(6)); // ::a.b.c.d, IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2002) return isPrivateIpv4(v4At(1)); // 6to4 wraps an IPv4 address
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * True for hosts a crawler must never be pointed at: loopback, link-local,
 * private ranges, cloud metadata, and local-only names. The SSRF guard. Takes
 * a URL hostname or a bare address from a DNS lookup.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = cleanHost(hostname);
  if (!host) return true;
  if (host === "localhost" || host === "broadcasthost") return true;
  if (/\.(localhost|local|internal|intranet|lan|home|corp|home\.arpa)$/.test(host)) return true;

  const v4 = parseIpv4(host);
  if (v4) return isPrivateIpv4(v4);

  if (host.includes(":")) {
    const v6 = parseIpv6(host);
    // Anything with a colon that does not parse as IPv6 is refused rather than guessed at.
    return v6 ? isPrivateIpv6(v6) : true;
  }
  return false;
}

/**
 * Turns what a person types into the site address the crawl starts from:
 * https, lowercased host, no hash, no query, no trailing slash except root.
 * Throws with a plain message on anything that is not a public http(s) site.
 */
export function normalizeSiteUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Enter a website address.");

  let withScheme: string;
  if (/^https?:\/\//i.test(raw)) withScheme = raw;
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || NON_PAGE_SCHEME_RE.test(raw)) {
    throw new Error("The address must start with http:// or https://.");
  } else withScheme = `https://${raw.replace(/^\/+/, "")}`;

  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error("That does not look like a website address.");
  }
  if (!HTTP_PROTOCOLS.has(u.protocol)) {
    throw new Error("The address must start with http:// or https://.");
  }

  const host = cleanHost(u.hostname);
  if (!host) throw new Error("That does not look like a website address.");
  if (isPrivateHost(host)) throw new Error("That address points to a private or local network.");
  if (!host.includes(".") && !isIpLiteral(host)) {
    throw new Error("Enter a full domain name, such as example.com.");
  }

  const hostPart = u.hostname.includes(":") ? `[${host}]` : host;
  const port = u.port ? `:${u.port}` : "";
  const path = normalizePath(u.pathname);
  return `https://${hostPart}${port}${path}`;
}

function normalizePath(pathname: string, keepTrailingSlash = false): string {
  let path = pathname.replace(/\/index\.html?$/i, "/");
  if (path.length > 1) path = keepTrailingSlash ? path.replace(/\/{2,}$/, "/") : path.replace(/\/+$/, "");
  return path || "/";
}

export type NormalizeUrlOptions = {
  /**
   * Keep a trailing slash the URL was written with. For URLs that will be
   * fetched: WordPress answers "/about-us" with a redirect to "/about-us/", so
   * the slash-less spelling costs a request per page, and a server that does
   * not redirect answers 404. Comparisons and urlKey still ignore the slash.
   */
  keepTrailingSlash?: boolean;
};

/**
 * One canonical spelling for a page URL so two links to the same page compare
 * equal: resolved against base, no hash, no tracking params, lowercased host,
 * default ports gone, no trailing slash except root (unless asked to keep it).
 * Null for anything that is not an http(s) page.
 */
export function normalizeUrl(url: string, base?: string, opts: NormalizeUrlOptions = {}): string | null {
  const raw = url.trim();
  if (!raw || NON_PAGE_SCHEME_RE.test(raw)) return null;

  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (!HTTP_PROTOCOLS.has(u.protocol)) return null;

  const host = cleanHost(u.hostname);
  if (!host) return null;
  const hostPart = u.hostname.includes(":") ? `[${host}]` : host;
  const port = u.port ? `:${u.port}` : "";
  const path = normalizePath(u.pathname, opts.keepTrailingSlash);

  let search = u.search.replace(/^\?/, "");
  if (search) {
    const params = new URLSearchParams(search);
    const kept = new URLSearchParams();
    let dropped = false;
    for (const [key, value] of params) {
      if (TRACKING_PARAM_RE.test(key)) dropped = true;
      else kept.append(key, value);
    }
    if (dropped) search = kept.toString();
  }

  return `${u.protocol}//${hostPart}${port}${path}${search ? `?${search}` : ""}`;
}

/** Host with the leading "www." removed, for same-site comparisons. */
export function siteHost(url: string): string | null {
  try {
    return cleanHost(new URL(url).hostname).replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Same host, treating www and non-www as the same site. */
export function isSameSite(a: string, b: string): boolean {
  const ha = siteHost(a);
  const hb = siteHost(b);
  return ha !== null && hb !== null && ha === hb;
}

/**
 * The dedupe key for a page: scheme and "www." ignored on top of normalizeUrl,
 * because sitemaps and on-page links often disagree on both.
 */
export function urlKey(url: string): string | null {
  const n = normalizeUrl(url);
  if (!n) return null;
  const u = new URL(n);
  const host = cleanHost(u.hostname).replace(/^www\./, "");
  const port = u.port ? `:${u.port}` : "";
  return `${host}${port}${u.pathname}${u.search}`;
}

const NON_HTML_EXT = new Set([
  "pdf", "jpg", "jpeg", "png", "gif", "svg", "webp", "avif", "bmp", "ico", "tif", "tiff", "heic",
  "zip", "gz", "tgz", "rar", "7z", "css", "js", "mjs", "map", "xml", "json", "txt", "csv", "rss",
  "atom", "mp4", "mp3", "m4a", "wav", "ogg", "webm", "mov", "avi", "woff", "woff2", "ttf", "otf",
  "eot", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "exe", "dmg", "apk", "ics", "vcf", "swf",
  "wasm", "xsl", "xsd", "yml", "yaml", "md",
]);

const SKIP_SEGMENT_RE =
  /^(wp-admin|wp-json|wp-login\.php|wp-content|wp-includes|wp-cron\.php|xmlrpc\.php|feed|feeds|rss|atom|cart|checkout|checkouts|account|accounts|my-account|login|logout|register|signin|sign-in|signup|sign-up|password|tag|tags|category|categories|author|search|cdn-cgi|_api|_partials|_next|admin|administrator|dashboard|wishlist|compare|trackback|embed|oembed|amp|print|cgi-bin|node_modules|assets|static|uploads|wp-uploads|media|images|img|fonts)$/i;

const SKIP_QUERY_RE =
  /^(replytocom|s|q|search|add-to-cart|add_to_cart|share|format|print|action|attachment_id|page|paged|sort|orderby|order|filter|filters|view|lang_switch|preview|preview_id|customize_changeset_uuid|elementor-preview|et_fb|fbclid|add-to-wishlist|variant)$/i;

/**
 * A cheap guess at whether a URL is an HTML page worth fetching: not an asset,
 * not an admin, feed, cart, or archive path, not a search or pagination query.
 */
export function looksLikeHtmlPath(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!HTTP_PROTOCOLS.has(u.protocol)) return false;

  const segments = u.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const dot = last.lastIndexOf(".");
  if (dot > 0) {
    const ext = last.slice(dot + 1).toLowerCase();
    if (NON_HTML_EXT.has(ext)) return false;
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = decodeURIComponent(segments[i]).toLowerCase();
    if (SKIP_SEGMENT_RE.test(seg)) return false;
    if (seg === "page" && /^\d+$/.test(segments[i + 1] ?? "")) return false;
    if (/^comment-page-\d+$/.test(seg)) return false;
  }

  if (u.search) {
    const params = Array.from(new URLSearchParams(u.search).keys());
    if (params.length > 3) return false;
    if (params.some((k) => SKIP_QUERY_RE.test(k))) return false;
  }
  return true;
}

type KeywordGroup = {
  id: string;
  score: number;
  reason: string;
  /** Single words matched against path or link-text tokens. */
  words: string[];
  /** Multi-word phrases matched against the token sequence. */
  phrases?: string[];
};

/*
  Scores: higher fetches first. Home 1000, generic page 300, legal 250,
  careers 200, product items and blog posts last. Depth takes a little off so
  short paths win ties.
*/
const GROUPS: KeywordGroup[] = [
  {
    id: "about",
    score: 900,
    reason: "about page",
    words: [
      "about", "aboutus", "company", "mission", "history", "overview", "philosophy",
      "values", "approach", "apropos", "impressum", "imprint", "sobre", "ueber",
    ],
    phrases: [
      "about us", "our story", "who we are", "our company", "our practice", "the practice",
      "our firm", "the firm", "our clinic", "why us", "why choose us", "our approach",
      "about me", "company profile", "a propos", "ueber uns", "uber uns", "sobre nosotros",
      "quienes somos", "chi siamo", "over ons", "om oss", "qui sommes nous",
    ],
  },
  {
    id: "team",
    score: 850,
    reason: "team page",
    words: [
      "team", "staff", "people", "meet", "leadership", "founders", "founder", "management",
      "doctors", "dentists", "therapists", "counsellors", "counselors", "attorneys", "lawyers",
      "physicians", "providers", "practitioners", "clinicians", "advisors", "advisers", "agents",
      "instructors", "trainers", "coaches", "bio", "bios", "biography", "equipe", "equipo",
    ],
    phrases: ["our team", "our people", "meet the team", "our doctors", "our therapists"],
  },
  {
    id: "contact",
    score: 800,
    reason: "contact page",
    words: [
      "contact", "contacts", "contactus", "book", "booking", "bookings", "appointment",
      "appointments", "schedule", "scheduling", "quote", "consultation", "consult", "enquiry",
      "enquire", "inquiry", "inquire", "kontakt", "contacto", "contatti", "visit",
    ],
    phrases: [
      "contact us", "get in touch", "reach us", "find us", "visit us", "book now", "book online",
      "request a quote", "get a quote", "free consultation",
    ],
  },
  {
    id: "faq",
    score: 750,
    reason: "faq page",
    words: ["faq", "faqs", "questions", "help", "support"],
    phrases: [
      "frequently asked questions", "common questions", "help center", "help centre",
      "knowledge base", "support center",
    ],
  },
  {
    id: "pricing",
    score: 700,
    reason: "pricing page",
    words: [
      "pricing", "prices", "price", "rates", "fees", "fee", "plans", "packages", "cost", "costs",
      "tarifs", "tariffs", "preise", "precios", "membership", "memberships", "investment",
    ],
    phrases: ["price list", "fee schedule", "our rates", "our fees"],
  },
  {
    id: "services",
    score: 650,
    reason: "services page",
    words: [
      "services", "service", "solutions", "treatments", "treatment", "therapies", "therapy",
      "specialties", "specialities", "specialty", "offerings", "programs", "program", "courses",
      "course", "capabilities", "expertise", "features", "menu", "menus", "leistungen",
      "dienstleistungen", "servicios", "servizi", "diensten", "prestations",
    ],
    phrases: ["what we do", "our services", "practice areas", "practice area", "what we offer", "how we help"],
  },
  {
    id: "products",
    score: 620,
    reason: "products page",
    words: ["products", "product", "shop", "store", "collections", "collection", "catalog", "catalogue"],
  },
  {
    id: "locations",
    score: 600,
    reason: "locations page",
    words: [
      "locations", "location", "areas", "offices", "office", "clinics", "clinic", "branches",
      "branch", "directions", "hours", "map", "showroom", "cities", "city", "coverage",
    ],
    phrases: [
      "service area", "service areas", "areas we serve", "areas served", "where we serve",
      "opening hours", "our location", "near me",
    ],
  },
  {
    id: "reviews",
    score: 550,
    reason: "reviews page",
    words: ["reviews", "review", "testimonials", "testimonial", "ratings", "feedback", "praise"],
    phrases: ["what clients say", "what our clients say", "client stories", "kind words"],
  },
  {
    id: "clients",
    score: 520,
    reason: "clients or case studies page",
    words: ["clients", "customers", "portfolio", "results", "casestudies", "partners"],
    phrases: [
      "case studies", "case study", "our clients", "our customers", "our work",
      "success stories", "before and after",
    ],
  },
  {
    id: "awards",
    score: 500,
    reason: "awards or press page",
    words: [
      "awards", "award", "press", "accreditations", "accreditation", "certifications",
      "certification", "credentials", "recognition", "achievements", "affiliations",
      "associations",
    ],
    phrases: ["in the news", "in the press", "press kit", "media kit"],
  },
  {
    id: "legal",
    score: 250,
    reason: "legal page",
    words: [
      "privacy", "terms", "tos", "legal", "disclaimer", "cookies", "accessibility", "returns",
      "gdpr", "sitemap",
    ],
    phrases: [
      "privacy policy", "terms of service", "terms of use", "terms and conditions",
      "terms conditions", "cookie policy", "refund policy", "shipping policy", "return policy",
      "legal notice", "site map", "html sitemap",
    ],
  },
  {
    id: "careers",
    score: 200,
    reason: "careers page",
    words: [
      "careers", "career", "jobs", "job", "hiring", "vacancies", "vacancy", "employment",
      "recruitment", "recruiting", "internships", "internship",
    ],
    phrases: [
      "join us", "join our team", "join the team", "we are hiring", "work with us",
      "work for us", "now hiring",
    ],
  },
];

const BLOG_WORDS = new Set([
  "blog", "blogs", "news", "article", "articles", "post", "posts", "insights", "insight",
  "resources", "resource", "journal", "updates", "stories", "guides", "guide", "tips", "learn",
  "knowledge", "library", "podcast", "podcasts", "videos", "video", "webinars", "webinar",
  "events", "event", "newsletter", "archive", "archives", "category", "tag", "author", "page",
]);

/** First segments under which every page is one product (Shopify, WooCommerce, Wix, Squarespace). */
const PRODUCT_PREFIXES = new Set([
  "products", "product", "collections", "collection", "shop", "store", "item", "items",
  "product-page", "catalog", "p",
]);

/** First segments that carry no meaning of their own: Shopify puts every content page under /pages/. */
const TRANSPARENT_PREFIXES = new Set(["pages"]);

/** Locale path prefixes ("/en", "/fr-ca"). Two letters alone are not enough: "/ep" is a slug. */
const LANGUAGE_CODES = new Set([
  "en", "fr", "de", "es", "it", "pt", "nl", "sv", "da", "no", "nb", "nn", "fi", "is", "pl", "cs",
  "sk", "hu", "ro", "bg", "el", "tr", "ru", "uk", "ja", "zh", "ko", "ar", "he", "hi", "id", "ms",
  "th", "vi", "ca", "eu", "gl", "hr", "sl", "sr", "lt", "lv", "et", "ga", "cy",
]);
const LOCALE_RE = /^([a-z]{2})(?:[-_]([a-z]{2}))?$/;

/*
  Stale copies. A WordPress site keeps old pages around ("about-us-old",
  "services-2", "/staging/contact", "homeold"), and an old copy can hold an old
  phone number or a departed therapist, which would show up as a false
  conflict. A page counts as a copy only when the live page it copies exists:
  "/staging/contact" next to "/contact", "about-2" next to "about". A home
  stager's "/staging/vacant-homes" and a lab's "/tests/blood-panel" have no
  live twin, so they are real pages.
*/

/** Folder names that hold a copy of the live site. */
const STALE_DIRS = new Set(["staging", "stage", "old", "draft", "drafts", "test", "tests", "backup", "temp", "tmp", "dev", "copy"]);

/** Suffixes that mark a copy of a sibling page: "about-us-old", "services-2". */
const STALE_SUFFIX_RE = /^(.+?)-(?:old|copy|draft|backup|temp|test|dup|duplicate|\d)$/;

/** A copy of the home page, which always exists: "homeold", "home-2", "old-home", "index-copy". */
const HOME_COPY_RE = /^(?:(?:home|homepage|index|main|front)[-_]?(?:old|copy|backup|bak|draft|temp|test|\d)|(?:old|copy)[-_]?(?:home|homepage|index))$/i;

/** Query keys that leave the home page the same page: "/?lang=en", "/?r=0". */
const HOME_QUERY_KEYS = new Set(["lang", "language", "locale", "hl", "r", "ref", "src", "source", "from", "amp", "v", "view", "s"]);

const HOME_SCORE = 1000;
const GENERIC_SCORE = 300;
const HOME_ALIAS_SCORE = 260;
const PRODUCT_ITEM_SCORE = 180;
const BLOG_SCORE = 100;
const LINK_TEXT_PENALTY = 50;
/**
 * Where a stale copy ranks, however it is linked: below every live page (the
 * deepest product page scores PRODUCT_ITEM_SCORE - 60) and above blog posts,
 * so a false match cannot bury a real page below the posts.
 */
const STALE_SCORE = BLOG_SCORE + 10;
/** Extra for a URL the home page links to: the site's own navigation says it matters. */
export const HOME_LINK_BONUS = 40;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/%20/g, " ")
    .split(/[^a-z0-9À-ɏ]+/)
    .filter(Boolean);
}

function isLocale(segment: string): boolean {
  const m = LOCALE_RE.exec(segment);
  return Boolean(m && LANGUAGE_CODES.has(m[1]));
}

/** How a group matched a token run, strongest first. */
type Strength = 3 | 2 | 1;

type Match = { group: KeywordGroup; strength: Strength; length: number };

/** Score taken off for a weaker match. */
const STRENGTH_PENALTY: Record<Strength, number> = { 3: 0, 2: 50, 1: 250 };

function phraseAt(tokens: string[], phrase: string[], at: number): boolean {
  return phrase.every((w, i) => tokens[at + i] === w);
}

/**
 * The group a run of tokens (one path segment, or a link's text) names, and
 * how strongly. A keyword at the head of the run is a strong match ("about-us",
 * "terms-of-service", "rates-policies"). In a short run (three tokens or fewer)
 * a keyword anywhere is nearly as strong ("meet-the-team"). In a run of four or
 * five a keyword past the head is weak ("pet-grooming-in-austin-tx"). In longer
 * runs, which are article titles, only the head counts: "pumpkin-to-talk-about-tee"
 * is not an about page. Longer phrases beat shorter ones, so "join our team" is
 * careers, not team, and "terms of service" is legal, not services.
 */
function matchTokens(tokens: string[]): Match | null {
  if (!tokens.length) return null;
  const n = tokens.length;
  let best: Match | null = null;
  const consider = (m: Match) => {
    if (
      !best ||
      m.strength > best.strength ||
      (m.strength === best.strength && m.length > best.length) ||
      (m.strength === best.strength && m.length === best.length && m.group.score > best.group.score)
    ) {
      best = m;
    }
  };

  for (const group of GROUPS) {
    for (const p of group.phrases ?? []) {
      const words = p.split(" ");
      if (phraseAt(tokens, words, 0)) consider({ group, strength: 3, length: words.length });
      else if (n <= 3 && tokens.some((_, i) => phraseAt(tokens, words, i))) consider({ group, strength: 3, length: words.length });
      else if (n <= 5 && tokens.some((_, i) => i > 0 && phraseAt(tokens, words, i))) consider({ group, strength: 1, length: words.length });
    }
    for (const w of group.words) {
      if (tokens[0] === w) consider({ group, strength: 3, length: 1 });
      else if (n <= 3 && tokens.includes(w)) consider({ group, strength: 2, length: 1 });
      else if (n <= 5 && tokens.includes(w)) consider({ group, strength: 1, length: 1 });
    }
  }
  return best;
}

function scoreOf(m: Match): number {
  return m.group.score - STRENGTH_PENALTY[m.strength];
}

function isHomePath(path: string): boolean {
  return path === "/" || path === "";
}

/** True when every query key leaves the page the same page (a language, a referral marker). */
function isHomeQuery(u: URL): boolean {
  const keys = Array.from(new URLSearchParams(u.search).keys());
  return keys.length > 0 && keys.every((k) => HOME_QUERY_KEYS.has(k.toLowerCase()));
}

/** Common first-level landing paths that are the home page under another name. */
const HOME_ALIAS_RE = /^\/(home|index(\.php|\.html?)?|main|welcome)\/?$/i;

function isHomeAlias(path: string, segments: string[]): boolean {
  return HOME_ALIAS_RE.test(path) || (segments.length === 1 && isLocale(segments[0]));
}

/**
 * Scores a URL for crawl order. The path decides first; the link text can
 * raise it. Returns the reason so the review screen can show why a page was
 * fetched.
 */
export function rankUrl(url: string, linkText?: string): { score: number; reason: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { score: 0, reason: "invalid url" };
  }

  const path = u.pathname.replace(/\/+$/, "") || "/";
  // "/?page_id=2" is a page of its own (WordPress plain permalinks); "/?lang=en" is the home page.
  if (isHomePath(path) && (!u.search || isHomeQuery(u))) return { score: HOME_SCORE, reason: "home page" };

  let segments = path.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  // The same home page under another path or language: rarely a new fact, so below generic pages.
  if (isHomeAlias(path, segments)) return { score: HOME_ALIAS_SCORE, reason: "home page (alias)" };

  // "/en/about" is the about page; "/pages/about" on Shopify too.
  while (segments.length > 1 && (isLocale(segments[0]) || TRANSPARENT_PREFIXES.has(segments[0].toLowerCase()))) {
    segments = segments.slice(1);
  }
  const depthPenalty = Math.min(60, Math.max(0, segments.length - 1) * 10);
  const first = segments[0]?.toLowerCase() ?? "";
  const firstTokens = tokenize(first);
  const lastTokens = tokenize(segments[segments.length - 1] ?? "");

  if (/\/(19|20)\d{2}\/\d{1,2}(\/|$)/.test(path)) return { score: BLOG_SCORE - 10 - depthPenalty, reason: "dated post" };

  const blogRoot = firstTokens.length > 0 && firstTokens.every((t) => BLOG_WORDS.has(t));
  if (blogRoot) {
    return segments.length > 1
      ? { score: BLOG_SCORE - 10 - depthPenalty, reason: "blog post" }
      : { score: BLOG_SCORE - depthPenalty, reason: "blog index" };
  }
  if (PRODUCT_PREFIXES.has(first) && segments.length > 1) {
    return { score: PRODUCT_ITEM_SCORE - depthPenalty, reason: "product page" };
  }

  let score = GENERIC_SCORE - depthPenalty;
  let reason = "page";

  // The last segment names the page; a parent segment only names its section, weakly.
  const own = matchTokens(lastTokens);
  if (own) {
    score = scoreOf(own) - depthPenalty;
    reason = own.group.reason;
  } else {
    for (const parent of segments.slice(0, -1).reverse()) {
      const section = matchTokens(tokenize(parent));
      if (!section) continue;
      const sectionScore = section.group.score - 300 - depthPenalty;
      if (sectionScore > score) {
        score = sectionScore;
        reason = `${section.group.reason.replace(/ page$/, "")} section`;
      }
      break;
    }
    if (reason === "page" && lastTokens.some((t) => BLOG_WORDS.has(t))) {
      score = BLOG_SCORE - depthPenalty;
      reason = "blog page";
    }
  }

  if (linkText) {
    const textTokens = tokenize(linkText);
    if (textTokens.length === 1 && textTokens[0] === "home" && !own) {
      return { score: HOME_SCORE - 50, reason: "home (link text)" };
    }
    // Link text of a sentence ("read more about our new mug") says nothing about the page.
    const text = textTokens.length <= 6 ? matchTokens(textTokens) : null;
    if (text && text.strength >= 2) {
      const textScore = scoreOf(text) - LINK_TEXT_PENALTY - depthPenalty;
      if (textScore > score) {
        score = textScore;
        reason = `${text.group.reason.replace(/ page$/, "")} (link text)`;
      }
    }
  }

  return { score, reason };
}


/** A path's segments, decoded and lowercased, without the trailing slash. */
function pathSegments(path: string): string[] {
  return path
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      try {
        return decodeURIComponent(seg).toLowerCase();
      } catch {
        return seg.toLowerCase();
      }
    });
}

/**
 * True when the path is a copy of a live page in `live` (paths as
 * pathSegments(...).join("/")): a folder copy, a suffixed copy, or a copy of
 * the home page.
 */
export function isStaleCopy(path: string, live: ReadonlySet<string>): boolean {
  const segs = pathSegments(path);
  if (!segs.length) return false;
  const last = segs[segs.length - 1];
  if (segs.length === 1 && HOME_COPY_RE.test(last)) return true;
  // "/staging/contact" copies "/contact"; a folder on its own ("/staging") is a page.
  for (let i = 0; i < segs.length - 1; i++) {
    if (STALE_DIRS.has(segs[i]) && live.has([...segs.slice(0, i), ...segs.slice(i + 1)].join("/"))) return true;
  }
  const m = STALE_SUFFIX_RE.exec(last);
  return Boolean(m && live.has([...segs.slice(0, -1), m[1]].join("/")));
}

/**
 * Dedupes, drops non-HTML and off-site URLs, ranks, caps. The home page is
 * always rank 0 when present. Ranks are 0..n in fetch order. A candidate the
 * home page links to gets HOME_LINK_BONUS.
 */
export function rankUrls(
  candidates: UrlCandidate[],
  opts: {
    home: string;
    max: number;
    /** URLs already queued or fetched, so a copy among the candidates can be told from its live twin. */
    known?: Iterable<string>;
  },
): RankedUrl[] {
  const homeKey = urlKey(opts.home);
  const byKey = new Map<string, { url: string; score: number; reason: string; pathLength: number }>();

  for (const c of candidates) {
    const normalized = normalizeUrl(c.url, opts.home, { keepTrailingSlash: true });
    if (!normalized) continue;
    if (!isSameSite(normalized, opts.home)) continue;
    if (!looksLikeHtmlPath(normalized)) continue;
    const key = urlKey(normalized);
    if (!key) continue;
    // "/?r=0" and "/?lang=en" are the home page again; "/?page_id=2" is not.
    const parsed = new URL(normalized);
    if (key !== homeKey && parsed.pathname === "/" && (!parsed.search || isHomeQuery(parsed))) continue;

    const ranked = key === homeKey ? { score: HOME_SCORE + 100, reason: "home page" } : rankUrl(normalized, c.text);
    const score = ranked.score + (c.fromHome && key !== homeKey ? HOME_LINK_BONUS : 0);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { url: normalized, score, reason: ranked.reason, pathLength: new URL(normalized).pathname.length });
    } else {
      if (score > existing.score) {
        existing.score = score;
        existing.reason = ranked.reason;
      }
      // Fetch the spelling the site publishes: a link the cleaner stripped loses to the sitemap's "/about-us/".
      if (normalized.endsWith("/") && !existing.url.endsWith("/") && new URL(normalized).pathname !== "/") {
        existing.url = normalized;
      }
    }
  }

  // A copy of a live page ("/staging/contact", "about-2", "homeold") ranks below the live pages.
  const live = new Set<string>();
  for (const url of [...Array.from(byKey.values(), (e) => e.url), ...(opts.known ?? [])]) {
    try {
      live.add(pathSegments(new URL(url).pathname).join("/"));
    } catch {
      // Not a URL; nothing to compare against.
    }
  }
  for (const entry of byKey.values()) {
    const path = new URL(entry.url).pathname;
    if (pathSegments(path).length && isStaleCopy(path, live)) {
      entry.score = STALE_SCORE;
      entry.reason = `${entry.reason}, old copy`;
    }
  }

  const sorted = Array.from(byKey.values()).sort(
    (a, b) => b.score - a.score || a.pathLength - b.pathLength || a.url.localeCompare(b.url),
  );

  return sorted
    .slice(0, Math.max(0, opts.max))
    .map((entry, rank) => ({ url: entry.url, rank, reason: entry.reason }));
}
