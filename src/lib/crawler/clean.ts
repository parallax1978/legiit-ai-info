/*
  cleanPage: one HTML document in, the head facts, JSON-LD, links, images,
  headings, and the body text out. Pure, no network. Order matters: the head
  and the links and images are read from the full document, then the noise
  is stripped, then the text is walked.
*/
import { load, type CheerioAPI } from "cheerio";
import { config } from "@/config";
import type { Json, JsonLdBlock, PageHeading, PageImage, PageLinks } from "@/lib/db/types";
import { attr, isElement, type DomElement } from "./dom";
import { collectImages } from "./images";
import { classifyLink, isShareLink, normalizeMailto, normalizeTel } from "./links";
import { collapseSpaces, extractLines, factLines, flatText, joinLines, normalizeChars, stripNoise } from "./text";
import { isSameSite, looksLikeHtmlPath, normalizeUrl, urlKey } from "./url";

export type CleanedPage = {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  lang: string | null;
  generator: string | null;
  ogImage: string | null;
  jsonld: JsonLdBlock[];
  links: PageLinks;
  images: PageImage[];
  headings: PageHeading[];
  text: string;
  textChars: number;
};

const MAX_INTERNAL_LINKS = 400;
const MAX_JSONLD_BLOCKS = 40;
const MAX_LINK_TEXT = 120;
const TRUNCATED_MARKER = "[truncated]";

export function cleanPage(html: string, url: string): CleanedPage {
  const $ = load(html);
  const pageUrl = safePageUrl(url);

  const head = readHead($, pageUrl);
  const jsonld = readJsonLd($);
  const links = collectLinks($, pageUrl);
  const images = collectImages($, pageUrl);
  const footer = readFooterFacts($);

  stripNoise($);

  const body = $("body").get(0) ?? $("html").get(0);
  const extracted = body ? extractLines(body) : { lines: [], headings: [] };
  const lines = [...extracted.lines];
  if (footer.length) lines.push("", "Footer:", ...footer);

  const text = capText(joinLines(lines), config.crawl.maxPageTextChars);

  return {
    ...head,
    jsonld,
    links,
    images,
    headings: extracted.headings,
    text,
    textChars: text.length,
  };
}

function safePageUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return "https://invalid.invalid/";
  }
}

function clean(value: string | undefined | null): string | null {
  if (!value) return null;
  const v = collapseSpaces(normalizeChars(value));
  return v || null;
}

function resolve(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

type Head = Pick<CleanedPage, "title" | "metaDescription" | "canonical" | "lang" | "generator" | "ogImage">;

function readHead($: CheerioAPI, pageUrl: string): Head {
  const metas = new Map<string, string>();
  $("meta").each((_, el) => {
    const key = (attr(el, "name") ?? attr(el, "property") ?? attr(el, "itemprop") ?? "").trim().toLowerCase();
    const content = attr(el, "content");
    if (key && content && !metas.has(key)) metas.set(key, content);
  });

  let canonical: string | null = null;
  $("link[rel]").each((_, el) => {
    if (canonical) return;
    const rel = (attr(el, "rel") ?? "").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) canonical = resolve(attr(el, "href"), pageUrl);
  });

  return {
    title: clean($("title").first().text()),
    metaDescription: clean(metas.get("description") ?? metas.get("og:description") ?? metas.get("twitter:description")),
    canonical,
    lang: clean($("html").attr("lang") ?? metas.get("og:locale")),
    generator: clean(metas.get("generator")),
    ogImage: resolve(metas.get("og:image") ?? metas.get("og:image:url") ?? metas.get("twitter:image"), pageUrl),
  };
}

function readJsonLd($: CheerioAPI): JsonLdBlock[] {
  const blocks: JsonLdBlock[] = [];
  $("script").each((_, el) => {
    if (blocks.length >= MAX_JSONLD_BLOCKS) return;
    const type = (attr(el, "type") ?? "").trim().toLowerCase();
    if (type !== "application/ld+json") return;
    const raw = $(el).text().trim();
    if (!raw) return;
    blocks.push(parseJsonLd(raw));
  });
  return blocks;
}

export function parseJsonLd(raw: string): JsonLdBlock {
  const cleaned = raw
    .replace(/^\s*<!--/, "")
    .replace(/-->\s*$/, "")
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, "")
    .replace(/\/\/\s*\]\]>\s*$/, "")
    .trim();
  try {
    const data = JSON.parse(cleaned) as Json;
    return { data, raw, types: collectTypes(data) };
  } catch (e) {
    return { data: null, raw, error: e instanceof Error ? e.message : "parse error", types: [] };
  }
}

/** Every @type in the block, top level, @graph, and nested objects, in order. */
export function collectTypes(data: Json, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || data === null || typeof data !== "object") return out;
  if (Array.isArray(data)) {
    for (const item of data) collectTypes(item, out, depth + 1);
    return out;
  }
  const t = data["@type"];
  const found = typeof t === "string" ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
  for (const name of found) if (!out.includes(name)) out.push(name);
  for (const [key, value] of Object.entries(data)) {
    if (key === "@type" || value === undefined) continue;
    collectTypes(value, out, depth + 1);
  }
  return out;
}

function linkText($: CheerioAPI, el: DomElement): string {
  const own = collapseSpaces(normalizeChars(flatText(el)));
  const text = own || attr(el, "aria-label") || attr(el, "title") || $(el).find("img").first().attr("alt") || "";
  const trimmed = collapseSpaces(normalizeChars(text));
  return trimmed.length > MAX_LINK_TEXT ? `${trimmed.slice(0, MAX_LINK_TEXT - 3)}...` : trimmed;
}

function collectLinks($: CheerioAPI, pageUrl: string): PageLinks {
  const tel: string[] = [];
  const mailto: string[] = [];
  const social = new Map<string, { platform: string; url: string; text?: string }>();
  const maps: string[] = [];
  const reviews = new Map<string, { site: string; url: string }>();
  const internal = new Map<string, { url: string; text: string }>();

  const push = (list: string[], value: string | null) => {
    if (value && !list.includes(value)) list.push(value);
  };

  $("a[href]").each((_, el) => {
    const href = (attr(el, "href") ?? "").trim();
    if (!href) return;

    if (/^tel:/i.test(href)) return push(tel, normalizeTel(href));
    if (/^mailto:/i.test(href)) {
      for (const email of normalizeMailto(href)) push(mailto, email);
      return;
    }

    const absolute = normalizeUrl(href, pageUrl);
    if (!absolute) return;
    if (isShareLink(absolute)) return;

    const cls = classifyLink(absolute);
    if (cls?.kind === "maps") return push(maps, absolute);
    if (cls?.kind === "reviews") {
      if (!reviews.has(absolute)) reviews.set(absolute, { site: cls.site, url: absolute });
      return;
    }
    if (cls?.kind === "social") {
      if (!social.has(absolute)) {
        const text = linkText($, el);
        social.set(absolute, text ? { platform: cls.platform, url: absolute, text } : { platform: cls.platform, url: absolute });
      }
      return;
    }

    if (!isSameSite(absolute, pageUrl) || !looksLikeHtmlPath(absolute)) return;
    const key = urlKey(absolute);
    if (!key || internal.size >= MAX_INTERNAL_LINKS) return;
    const existing = internal.get(key);
    const text = linkText($, el);
    if (!existing) internal.set(key, { url: absolute, text });
    else if (!existing.text && text) existing.text = text;
  });

  return {
    tel,
    mailto,
    social: Array.from(social.values()),
    maps,
    reviews: Array.from(reviews.values()),
    internal: Array.from(internal.values()),
  };
}

/**
 * The footer is stripped from the body text, but its copyright line, address,
 * phone, hours, and registration claims are facts the template asks for, so
 * those lines are kept under a "Footer:" marker at the end of the text.
 */
function readFooterFacts($: CheerioAPI): string[] {
  const lines: string[] = [];
  $("footer, [role=contentinfo], #footer, #colophon, .site-footer, .footer").each((_, el) => {
    if (!isElement(el) || $(el).parents("footer, [role=contentinfo]").length) return;
    const clone = load("<div></div>");
    clone("div").append($(el).clone());
    clone("script, style, noscript, svg, iframe, form, [class*='cookie'], [id*='cookie']").remove();
    const root = clone("div").get(0);
    if (root) lines.push(...extractLines(root).lines);
  });
  return factLines(lines);
}

function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = Math.max(0, max - TRUNCATED_MARKER.length - 1);
  return `${text.slice(0, keep).trimEnd()}\n${TRUNCATED_MARKER}`;
}
