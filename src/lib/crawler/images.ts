/*
  Logo, award, and badge candidates from the images on a page. The signals
  are file name, alt text, class and id, the parent's class, and whether the
  image sits inside a link to the home page in the header. No network.
*/
import type { CheerioAPI } from "cheerio";
import type { PageImage } from "@/lib/db/types";
import { ancestors, attr, closestElement, tagName, type DomElement } from "./dom";
import { collapseSpaces, normalizeChars } from "./text";
import { isSameSite, normalizeUrl, urlKey } from "./url";

const MAX_IMAGES = 60;

const AWARD_RE =
  /(^|[^a-z])(awards?|winners?|winning|best[-_ ]?of|readers?[-_ ]?choice|choice|top[-_ ]?rated|rated|three[-_ ]?best|finalist|excellence|trophy|medal|ranked|nominee|nominated|laureate|badges?)(?=[^a-z]|$)/gi;
const AWARD_YEAR_RE = /\b(2019|202[0-6])\b/;
const AWARD_YEAR_WORD_RE = /\b(best|top|rated|winner|award|choice)\b/i;
const BADGE_RE =
  /(^|[^a-z])(bbb|chamber|association|assoc|members?|membership|accredited|accreditation|certified|certification|certificate|verified|registered|licensed|licenced|insured|partner|affiliate|council|college|institute|society|board|trusted|guarantee|seal|federation|alliance|approved|authori[sz]ed)(?=[^a-z]|$)/gi;
const LOGO_RE = /logo|brand-mark|brandmark|wordmark|site-title|site-branding/gi;
const PIXEL_RE = /\/(pixel|tracking|tr\?|beacon|spacer|blank|transparent|1x1)\b|facebook\.com\/tr|\.gif\?/i;

const HEADER_WORD_RE = /^(header|site-header|masthead|navbar|top-bar|topbar|main-header|page-header|site-branding|branding|site-logo|logo|navigation|nav|menu|menubar|site-title)$/i;

const HOME_PATH_RE = /^\/(home|index\.(php|html?)|[a-z]{2}(-[a-z]{2})?)?\/?$/i;

type ImageField = { field: string; text: string };

function firstSrcsetCandidate(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
  return first || undefined;
}

function pickSource(el: DomElement): string | undefined {
  const candidates = [
    attr(el, "src"),
    attr(el, "data-src"),
    attr(el, "data-lazy-src"),
    attr(el, "data-original"),
    firstSrcsetCandidate(attr(el, "srcset")),
    firstSrcsetCandidate(attr(el, "data-srcset")),
    firstSrcsetCandidate(attr(el, "data-lazy-srcset")),
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v && !/^data:/i.test(v) && !/^blob:/i.test(v)) return v;
  }
  return undefined;
}

function resolveImage(src: string, pageUrl: string): string | null {
  try {
    const u = new URL(src, pageUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** True when a link's href points at the site's home page. */
export function isHomeHref(href: string | undefined, pageUrl: string): boolean {
  if (href === undefined) return false;
  const h = href.trim();
  if (h === "/") return true;
  if (!h || h.startsWith("#")) return false;
  const n = normalizeUrl(h, pageUrl);
  if (!n || !isSameSite(n, pageUrl)) return false;
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return false;
  }
  if (urlKey(n) === urlKey(`${origin}/`)) return true;
  return HOME_PATH_RE.test(new URL(n).pathname);
}

function homeLinkOf(el: DomElement, pageUrl: string): DomElement | null {
  return closestElement(el, (a) => tagName(a) === "a" && isHomeHref(attr(a, "href"), pageUrl), false);
}

function inHeader(el: DomElement): boolean {
  for (const a of ancestors(el, 25)) {
    const name = tagName(a);
    if (name === "header" || name === "nav") return true;
    if ((attr(a, "role") ?? "").toLowerCase() === "banner") return true;
    const id = attr(a, "id") ?? "";
    if (id && HEADER_WORD_RE.test(id)) return true;
    for (const token of (attr(a, "class") ?? "").split(/\s+/)) {
      if (HEADER_WORD_RE.test(token)) return true;
      if (/header|masthead|navbar/i.test(token)) return true;
    }
  }
  return false;
}

function matchTerms(re: RegExp, text: string): string[] {
  const found: string[] = [];
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const term = (m[2] ?? m[0]).toLowerCase();
    if (!found.includes(term)) found.push(term);
  }
  return found;
}

function describe(field: string, terms: string[]): string {
  return `${field} has ${terms.map((t) => `"${t}"`).join(", ")}`;
}

function classify(
  fields: ImageField[],
  inHomeLink: boolean,
  headerHomeLink: boolean,
): { kind: PageImage["kind"]; reason: string } {
  if (headerHomeLink) return { kind: "logo", reason: "inside the home link in the header" };

  let badgeWord: { field: string; terms: string[] } | null = null;
  for (const f of fields) {
    const terms = matchTerms(AWARD_RE, f.text);
    const strong = terms.filter((t) => !/^badges?$/.test(t));
    if (strong.length) return { kind: "award", reason: describe(f.field, strong) };
    if (terms.length && !badgeWord) badgeWord = { field: f.field, terms };
    if (AWARD_YEAR_RE.test(f.text) && AWARD_YEAR_WORD_RE.test(f.text)) {
      const year = AWARD_YEAR_RE.exec(f.text)?.[1] ?? "";
      const word = AWARD_YEAR_WORD_RE.exec(f.text)?.[1] ?? "";
      return { kind: "award", reason: describe(f.field, [word.toLowerCase(), year]) };
    }
  }
  for (const f of fields) {
    const terms = matchTerms(BADGE_RE, f.text);
    if (terms.length) return { kind: "badge", reason: describe(f.field, terms) };
  }
  if (badgeWord) return { kind: "award", reason: describe(badgeWord.field, badgeWord.terms) };
  for (const f of fields) {
    const terms = matchTerms(LOGO_RE, f.text);
    if (terms.length) return { kind: "logo", reason: describe(f.field, terms) };
  }
  if (inHomeLink) return { kind: "logo", reason: "inside a link to the home page" };
  return { kind: "other", reason: "no signal" };
}

const KIND_ORDER: Record<PageImage["kind"], number> = { logo: 0, award: 1, badge: 2, other: 3 };

/** Images on the page, logos and awards first, at most 60. */
export function collectImages($: CheerioAPI, pageUrl: string): PageImage[] {
  const out: PageImage[] = [];
  const seen = new Set<string>();

  $("img").each((_, el) => {
    const width = attr(el, "width");
    const height = attr(el, "height");
    if (width === "1" && height === "1") return;

    const raw = pickSource(el);
    if (!raw) return;
    const src = resolveImage(raw, pageUrl);
    if (!src || PIXEL_RE.test(src) || seen.has(src)) return;

    const alt = (attr(el, "alt") ?? "").replace(/\s+/g, " ").trim();
    const parent = el.parent && "attribs" in el.parent ? el.parent : null;
    const path = decodeURIComponentSafe(new URL(src).pathname);
    const fileName = path.split("/").pop() ?? "";
    const fields: ImageField[] = [
      { field: "file name", text: fileName },
      { field: "path", text: path.slice(0, path.length - fileName.length) },
      { field: "alt", text: alt },
      { field: "class", text: attr(el, "class") ?? "" },
      { field: "id", text: attr(el, "id") ?? "" },
      { field: "title", text: attr(el, "title") ?? "" },
      { field: "parent class", text: parent ? `${attr(parent, "class") ?? ""} ${attr(parent, "id") ?? ""}` : "" },
    ].filter((f) => f.text);

    const homeLink = homeLinkOf(el, pageUrl);
    const headerHomeLink = homeLink !== null && inHeader(el);
    const { kind, reason } = classify(fields, homeLink !== null, headerHomeLink);

    seen.add(src);
    out.push({ src, alt, kind, reason });
  });

  // An inline SVG logo has no src; keep it only when it sits in a home link.
  $("a[href] svg").each((_, el) => {
    const link = homeLinkOf(el, pageUrl);
    if (!link || seen.has("inline-svg")) return;
    const title = collapseSpaces(normalizeChars($(el).find("title").first().text()));
    const alt = title || collapseSpaces(normalizeChars(attr(link, "aria-label") ?? attr(link, "title") ?? ""));
    seen.add("inline-svg");
    out.push({ src: "inline-svg", alt, kind: "logo", reason: "inline svg inside a link to the home page" });
  });

  return out
    .map((img, i) => ({ img, i }))
    .sort((a, b) => KIND_ORDER[a.img.kind] - KIND_ORDER[b.img.kind] || a.i - b.i)
    .slice(0, MAX_IMAGES)
    .map(({ img }) => img);
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
