/*
  URL helpers for the crawler. Pure functions, no network, no server-only
  imports, so vitest runs them in node.
*/

export type RankedUrl = { url: string; rank: number; reason: string };
export type UrlCandidate = { url: string; text?: string };

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

function normalizePath(pathname: string): string {
  let path = pathname.replace(/\/index\.html?$/i, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}

/**
 * One canonical spelling for a page URL so two links to the same page compare
 * equal: resolved against base, no hash, no tracking params, lowercased host,
 * default ports gone, no trailing slash except root. Null for anything that
 * is not an http(s) page.
 */
export function normalizeUrl(url: string, base?: string): string | null {
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
  const path = normalizePath(u.pathname);

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
  careers 200, blog last. Depth takes a little off so short paths win ties.
*/
const GROUPS: KeywordGroup[] = [
  {
    id: "about",
    score: 900,
    reason: "about page",
    words: [
      "about", "aboutus", "story", "company", "mission", "history", "overview", "profile",
      "philosophy", "values", "approach", "apropos", "impressum", "imprint", "sobre", "ueber",
      "uber", "chi", "over", "om",
    ],
    phrases: [
      "about us", "our story", "who we are", "our company", "our practice", "the practice",
      "our firm", "the firm", "our clinic", "why us", "why choose us", "our approach",
      "about me", "a propos", "ueber uns", "uber uns", "sobre nosotros", "quienes somos",
      "chi siamo", "over ons", "om oss", "qui sommes nous",
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
      "instructors", "trainers", "coaches", "bio", "bios", "biography", "profiles", "equipe",
      "equipo",
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
    words: ["faq", "faqs", "questions"],
    phrases: ["frequently asked questions", "common questions"],
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
      "course", "capabilities", "expertise", "features", "feature", "platform", "menu", "menus",
      "leistungen", "dienstleistungen", "servicios", "servizi", "diensten", "prestations",
      "support", "help",
    ],
    phrases: [
      "what we do", "our services", "practice areas", "practice area", "what we offer",
      "how we help", "help center", "knowledge base",
    ],
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
    words: [
      "clients", "customers", "portfolio", "work", "projects", "project", "results",
      "casestudies", "partners",
    ],
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
      "awards", "award", "press", "media", "accreditations", "accreditation", "certifications",
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
      "privacy policy", "terms of service", "terms and conditions", "terms conditions",
      "cookie policy", "refund policy", "shipping policy", "return policy", "legal notice",
      "site map", "html sitemap",
    ],
  },
];

const CAREERS: KeywordGroup = {
  id: "careers",
  score: 200,
  reason: "careers page",
  words: [
    "careers", "career", "jobs", "job", "hiring", "vacancies", "vacancy", "employment",
    "recruitment", "recruiting", "opportunities", "internships", "internship",
  ],
  phrases: ["join us", "join our team", "join the team", "we are hiring", "work with us", "work for us", "now hiring"],
};

const BLOG_WORDS = new Set([
  "blog", "blogs", "news", "article", "articles", "post", "posts", "insights", "insight",
  "resources", "resource", "journal", "updates", "stories", "guides", "guide", "tips", "learn",
  "knowledge", "library", "podcast", "podcasts", "videos", "video", "webinars", "webinar",
  "events", "event", "newsletter", "archive", "archives", "category", "tag", "author", "page",
]);

const HOME_SCORE = 1000;
const GENERIC_SCORE = 300;
const BLOG_SCORE = 100;
const LINK_TEXT_PENALTY = 50;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/%20/g, " ")
    .split(/[^a-z0-9\u00c0-\u024f]+/)
    .filter(Boolean);
}

function matchGroup(group: KeywordGroup, tokens: string[], joined: string): boolean {
  if (group.phrases?.some((p) => ` ${joined} `.includes(` ${p} `))) return true;
  return tokens.some((t) => group.words.includes(t));
}

function bestGroup(tokens: string[]): KeywordGroup | null {
  const joined = tokens.join(" ");
  if (matchGroup(CAREERS, tokens, joined)) return CAREERS;
  let best: KeywordGroup | null = null;
  for (const g of GROUPS) {
    if (!matchGroup(g, tokens, joined)) continue;
    if (!best || g.score > best.score) best = g;
  }
  return best;
}

function isHomePath(path: string): boolean {
  return path === "/" || path === "";
}

/** Common first-level landing paths that are the home page under another name. */
const HOME_ALIAS_RE = /^\/(home|index(\.php|\.html?)?|main|welcome|[a-z]{2}(-[a-z]{2})?)\/?$/i;

/**
 * Scores a URL for crawl order. The path decides first; the link text can
 * raise a generic path. Returns the reason so the review screen can show why
 * a page was fetched.
 */
export function rankUrl(url: string, linkText?: string): { score: number; reason: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { score: 0, reason: "invalid url" };
  }

  const path = u.pathname.replace(/\/+$/, "") || "/";
  if (isHomePath(path)) return { score: HOME_SCORE, reason: "home page" };

  const segments = path.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  const depthPenalty = Math.min(60, Math.max(0, segments.length - 1) * 10);

  if (HOME_ALIAS_RE.test(path)) return { score: HOME_SCORE - 50, reason: "home page (alias)" };

  const pathTokens = tokenize(segments.join(" "));
  const firstTokens = tokenize(segments[0] ?? "");
  const dated = /\/(19|20)\d{2}\/\d{1,2}(\/|$)/.test(path);
  const blogRoot = firstTokens.length > 0 && firstTokens.every((t) => BLOG_WORDS.has(t));

  if (dated) return { score: BLOG_SCORE - 10 - depthPenalty, reason: "dated post" };
  if (blogRoot && segments.length > 1) {
    return { score: BLOG_SCORE - 10 - depthPenalty, reason: "blog post" };
  }
  if (blogRoot) return { score: BLOG_SCORE - depthPenalty, reason: "blog index" };

  let score = GENERIC_SCORE - depthPenalty;
  let reason = "page";

  const pathGroup = bestGroup(pathTokens);
  if (pathGroup) {
    score = pathGroup.score - depthPenalty;
    reason = pathGroup.reason;
  } else if (pathTokens.some((t) => BLOG_WORDS.has(t))) {
    score = BLOG_SCORE - depthPenalty;
    reason = "blog page";
  }

  if (linkText) {
    const textTokens = tokenize(linkText);
    const textGroup = bestGroup(textTokens);
    const homeText = textTokens.length === 1 && textTokens[0] === "home";
    if (homeText && !pathGroup) {
      return { score: HOME_SCORE - 50, reason: "home (link text)" };
    }
    if (textGroup) {
      const textScore = textGroup.score - LINK_TEXT_PENALTY - depthPenalty;
      if (textScore > score) {
        score = textScore;
        reason = `${textGroup.reason.replace(/ page$/, "")} (link text)`;
      }
    }
  }

  return { score, reason };
}

/**
 * Dedupes, drops non-HTML and off-site URLs, ranks, caps. The home page is
 * always rank 0 when present. Ranks are 0..n in fetch order.
 */
export function rankUrls(
  candidates: UrlCandidate[],
  opts: { home: string; max: number },
): RankedUrl[] {
  const homeKey = urlKey(opts.home);
  const byKey = new Map<string, { url: string; score: number; reason: string; pathLength: number }>();

  for (const c of candidates) {
    const normalized = normalizeUrl(c.url, opts.home);
    if (!normalized) continue;
    if (!isSameSite(normalized, opts.home)) continue;
    if (!looksLikeHtmlPath(normalized)) continue;
    const key = urlKey(normalized);
    if (!key) continue;

    const ranked = key === homeKey ? { score: HOME_SCORE, reason: "home page" } : rankUrl(normalized, c.text);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { url: normalized, ...ranked, pathLength: new URL(normalized).pathname.length });
    } else if (ranked.score > existing.score) {
      existing.score = ranked.score;
      existing.reason = ranked.reason;
    }
  }

  const sorted = Array.from(byKey.values()).sort(
    (a, b) => b.score - a.score || a.pathLength - b.pathLength || a.url.localeCompare(b.url),
  );

  return sorted
    .slice(0, Math.max(0, opts.max))
    .map((entry, rank) => ({ url: entry.url, rank, reason: entry.reason }));
}
