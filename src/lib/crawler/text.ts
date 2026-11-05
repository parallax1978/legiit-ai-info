/*
  Noise stripping and text extraction over a loaded cheerio document. The
  text is what the extractor quotes from, so the walk is deterministic and the
  characters are normalized (straight quotes, plain spaces).
*/
import type { CheerioAPI } from "cheerio";
import type { PageHeading } from "@/lib/db/types";
import { ancestors, attr, classTokens, isElement, isText, tagName, type DomElement, type DomNode } from "./dom";

/** Quotes, spaces, and invisible characters made plain so quote checks are stable. */
export function normalizeChars(s: string): string {
  return s
    .replace(/[   -   　]/g, " ")
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/[‘’‚‛′´‵]/g, "'")
    .replace(/[“”„‟″‶]/g, '"');
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const REMOVE_SELECTOR = [
  "script", "style", "noscript", "template", "iframe", "svg", "canvas", "video", "audio",
  "object", "embed", "nav", "aside", "button", "input", "select", "textarea", "footer",
  "[role=navigation]", "[role=banner]", "[role=contentinfo]",
].join(", ");

const NEVER_STRIP = new Set(["html", "body", "main", "article"]);

/** Substring match on class and id: cookie walls name themselves in many ways. */
const HARD_RE = /cookie|consent|gdpr/i;

/** Whole-word match on class and id words (split on -, _, and camelCase). */
const NOISE_WORDS = new Set([
  "popup", "popups", "modal", "modals", "newsletter", "subscribe", "breadcrumb", "breadcrumbs",
  "share", "sharing", "menu", "menus", "navbar", "sidebar", "sidebars", "navigation", "lightbox",
  "offcanvas", "comments", "tooltip",
]);

/** Whole-token match on class tokens. */
const NOISE_TOKENS = new Set([
  "skip-link", "skiplink", "skip-to-content", "screen-reader-text", "screen-reader-only",
  "sr-only", "visually-hidden", "visuallyhidden", "social-links", "social-icons",
  "social-share", "share-buttons", "nav", "main-nav", "site-nav", "primary-nav", "top-nav",
  "mobile-nav", "header-nav", "footer-nav", "nav-menu", "back-to-top", "scroll-top",
  "elementor-location-header", "elementor-location-footer",
]);

function words(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isNoiseElement(el: DomElement): boolean {
  const classAttr = attr(el, "class") ?? "";
  const id = attr(el, "id") ?? "";
  if (!classAttr && !id) return false;
  if (HARD_RE.test(`${classAttr} ${id}`)) return true;
  const tokens = [...classTokens(el), ...(id ? [id] : [])];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (NOISE_TOKENS.has(lower)) return true;
    if (words(token).some((w) => NOISE_WORDS.has(w))) return true;
  }
  return false;
}

function textLength(el: DomElement): number {
  let n = 0;
  const stack: DomNode[] = [...el.children];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (isText(node)) n += node.data.length;
    else if (isElement(node)) stack.push(...node.children);
  }
  return n;
}

/**
 * Removes chrome and noise in place: scripts and styles, navigation, header
 * and footer, forms and controls, hidden bits, cookie banners, popups, share
 * bars, sidebars. Keeps any element that holds most of the page, so a class
 * like "menu-section" on a restaurant's menu page cannot empty the page.
 */
export function stripNoise($: CheerioAPI): void {
  $(REMOVE_SELECTOR).remove();

  const body = $("body").get(0);
  const bodyLength = body ? textLength(body) : 0;
  const holdsMostOfPage = (el: DomElement) => {
    const len = textLength(el);
    return len > 500 && len * 2 > bodyLength;
  };

  // Site headers go; a header inside an article or main is the content's own title block.
  $("header").each((_, el) => {
    if (!ancestors(el).some((a) => tagName(a) === "article" || tagName(a) === "main")) $(el).remove();
  });

  // Decorative hidden bits go; a long hidden block is usually a collapsed panel with real text.
  $("[aria-hidden=true]").each((_, el) => {
    if (textLength(el) < 300) $(el).remove();
  });

  // Forms go unless the whole page sits in one (classic ASP.NET), then the wrapper is unwrapped.
  $("form").each((_, el) => {
    if (holdsMostOfPage(el)) $(el).replaceWith($(el).contents());
    else $(el).remove();
  });

  $("[class], [id]").each((_, el) => {
    if (NEVER_STRIP.has(tagName(el))) return;
    if (!el.parent) return; // already removed with an ancestor
    if (!isNoiseElement(el)) return;
    if (holdsMostOfPage(el)) return;
    $(el).remove();
  });
}

const HEADING_RE = /^h[1-6]$/;

const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "iframe", "svg", "canvas", "video", "audio",
  "object", "embed", "head", "title", "meta", "link", "option", "datalist", "map",
]);

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "blockquote", "figcaption", "summary", "details",
  "dt", "dd", "dl", "ul", "ol", "menu", "table", "thead", "tbody", "tfoot", "caption", "address",
  "figure", "fieldset", "legend", "hr", "body", "html", "header", "footer", "aside", "nav",
  "center", "form", "label", "output", "search", "hgroup", "picture",
]);

type Walker = { out: string[]; inline: string[]; headings: PageHeading[] };

function flush(w: Walker): void {
  const line = collapseSpaces(w.inline.join(""));
  w.inline.length = 0;
  if (line) w.out.push(line);
}

/** All text under an element as one line, block boundaries becoming spaces. */
export function flatText(el: DomElement): string {
  const parts: string[] = [];
  const visit = (node: DomNode) => {
    if (isText(node)) {
      parts.push(normalizeChars(node.data));
      return;
    }
    if (!isElement(node)) return;
    const name = tagName(node);
    if (SKIP_TAGS.has(name)) return;
    if (name === "br" || BLOCK_TAGS.has(name) || HEADING_RE.test(name) || name === "li" || name === "tr" || name === "td" || name === "th") {
      parts.push(" ");
      for (const child of node.children) visit(child);
      parts.push(" ");
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(el);
  return collapseSpaces(parts.join(""));
}

function walkChildren(el: DomElement, w: Walker): void {
  for (const child of el.children) walkNode(child, w);
}

function walkNode(node: DomNode, w: Walker): void {
  if (isText(node)) {
    w.inline.push(normalizeChars(node.data));
    return;
  }
  if (!isElement(node)) return;
  const name = tagName(node);
  if (SKIP_TAGS.has(name)) return;

  if (name === "br") {
    flush(w);
    return;
  }

  if (HEADING_RE.test(name)) {
    flush(w);
    const text = flatText(node);
    if (text) {
      const level = Number(name[1]);
      w.headings.push({ level, text });
      w.out.push("", `${"#".repeat(level)} ${text}`);
    }
    return;
  }

  if (name === "li") {
    flush(w);
    const sub: Walker = { out: [], inline: [], headings: w.headings };
    walkChildren(node, sub);
    flush(sub);
    const first = sub.out.findIndex((line) => line && !line.startsWith("#"));
    if (first >= 0) sub.out[first] = `- ${sub.out[first]}`;
    w.out.push(...sub.out);
    return;
  }

  if (name === "tr") {
    flush(w);
    const cells: string[] = [];
    for (const child of node.children) {
      if (!isElement(child)) continue;
      const cn = tagName(child);
      if (cn !== "td" && cn !== "th") continue;
      const text = flatText(child);
      if (text) cells.push(text);
    }
    if (cells.length) w.out.push(cells.join(" | "));
    return;
  }

  if (name === "pre") {
    flush(w);
    const raw = flatPre(node);
    for (const line of raw.split("\n")) {
      const l = collapseSpaces(line);
      if (l) w.out.push(l);
    }
    return;
  }

  if (BLOCK_TAGS.has(name)) {
    flush(w);
    walkChildren(node, w);
    flush(w);
    return;
  }

  walkChildren(node, w);
}

function flatPre(el: DomElement): string {
  const parts: string[] = [];
  const visit = (node: DomNode) => {
    if (isText(node)) parts.push(normalizeChars(node.data));
    else if (isElement(node)) {
      if (tagName(node) === "br") parts.push("\n");
      for (const child of node.children) visit(child);
    }
  };
  visit(el);
  return parts.join("");
}

export type ExtractedText = { lines: string[]; headings: PageHeading[] };

/** Walks an element in document order and returns its lines and headings. */
export function extractLines(root: DomElement): ExtractedText {
  const w: Walker = { out: [], inline: [], headings: [] };
  walkNode(root, w);
  flush(w);
  return { lines: w.out, headings: w.headings };
}

/** Lines joined, blank runs collapsed, ends trimmed. */
export function joinLines(lines: string[]): string {
  return lines
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

const FACT_LINE_RE = [
  /©|\(c\)\s*(19|20)\d{2}|copyright/i,
  /\b(llc|l\.l\.c\.|inc\.?|incorporated|ltd\.?|limited|corp\.?|corporation|gmbh|pty|plc|pllc|llp|lp|s\.?a\.?s?\.?|b\.?v\.?|co\.)(\s|,|$)/i,
  /\b(suite|ste\.?|unit|floor|street|st\.|avenue|ave\.?|road|rd\.?|blvd\.?|boulevard|drive|dr\.|lane|ln\.|way|court|ct\.|highway|hwy|parkway|pkwy|plaza|square)\b/i,
  /\b[a-z]{1,2}\d[a-z]?\s?\d[a-z]{2}\b/i,
  /\b\d{5}(-\d{4})?\b/,
  /\+?\d[\d\s().-]{7,}\d/,
  /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b.*\d/i,
  /\d\s?(am|pm)\b/i,
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/i,
  /\b(registered|licensed|licenced|accredited|member of|certified|insured|bonded|est\.?\s?(19|20)\d{2}|since\s(19|20)\d{2}|founded)\b/i,
];

const FOOTER_NOISE_RE = /^(privacy|terms|cookie|sitemap|site map|all rights reserved|powered by|designed by|website by|built by|web design by)/i;

/**
 * Lines from a stripped block that carry facts the footer usually holds: the
 * copyright line with the legal name, address, phone, email, hours, and
 * registration claims. Nav links and boilerplate are left out.
 */
export function factLines(lines: string[], max = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.replace(/^- /, "").trim();
    if (!line || /^#{1,6} /.test(line) || line.length < 6) continue;
    if (FOOTER_NOISE_RE.test(line)) continue;
    if (!FACT_LINE_RE.some((re) => re.test(line))) continue;
    const clipped = line.length > 240 ? `${line.slice(0, 237)}...` : line;
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clipped);
    if (out.length >= max) break;
  }
  return out;
}
