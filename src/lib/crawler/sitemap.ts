/*
  Sitemaps: parse one file, and walk a site's sitemap tree breadth-first with
  caps. Page sitemaps are read before post, tag, category, author, and
  attachment sitemaps, which are skipped when a page sitemap exists.
*/
import { load } from "cheerio";
import { isElement, tagName, type DomElement, type DomNode } from "./dom";
import { MIN_REQUEST_MS, fetchText, type ResolveHost } from "./fetch";
import { isSameSite, looksLikeHtmlPath, normalizeUrl, urlKey } from "./url";

export type ParsedSitemap = { kind: "index" | "urlset" | "unknown"; urls: string[] };

export type DiscoverSitemapOptions = {
  userAgent: string;
  timeoutMs: number;
  maxSitemaps: number;
  maxUrls: number;
  fetchImpl?: typeof fetch;
  resolveHost?: ResolveHost;
  /** Epoch milliseconds. The walk stops here with what it has; see FetchPageOptions.deadline. */
  deadline?: number;
};

export type DiscoveredSitemaps = { urls: string[]; sitemapsRead: string[] };

const MAX_SITEMAP_BYTES = 6_000_000;

export const DEFAULT_SITEMAP_PATHS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/wp-sitemap.xml",
  "/sitemap-index.xml",
  "/page-sitemap.xml",
];

const PAGE_SITEMAP_RE = /(^|\/)(pages?[-_]sitemap|sitemap[-_]pages?|wp-sitemap-posts-page-|sitemap-pt-page)[^/]*$/i;

/** Read only when no page sitemap exists. */
const SECONDARY_SITEMAP_RE =
  /(post[-_]sitemap|wp-sitemap-posts-post-|sitemap[-_]posts?|sitemap-pt-post|blog[-_]?posts?[-_]sitemap|blog[-_]sitemap|sitemap[-_]blogs?|sitemap[-_]articles?|portfolio|testimonial|faq[-_]sitemap|local[-_]sitemap|web-stories|sitemap-misc|collections?)/i;

/** Never worth reading for an About page. */
const SKIP_SITEMAP_RE =
  /(tag|categor|author|user|attachment|taxonom|image|video|news|product_cat|product_tag|sitemap-pt-attachment|xsl$|\.gz$)/i;

const localName = (el: DomElement) => tagName(el).replace(/^.*:/, "");

function childElements(node: DomNode): DomElement[] {
  if (!isElement(node)) return [];
  return node.children.filter((c): c is DomElement => isElement(c));
}

function locOf(entry: DomElement): string | null {
  const loc = childElements(entry).find((c) => localName(c) === "loc");
  if (!loc) return null;
  const text = loc.children
    .map((c) => ("data" in c && typeof c.data === "string" ? c.data : ""))
    .join("")
    .trim();
  return /^https?:\/\//i.test(text) ? text : null;
}

/** Reads a sitemap index or urlset. Tolerates junk, prefixes, and text sitemaps. */
export function parseSitemap(xml: string): ParsedSitemap {
  const trimmed = xml.replace(/^﻿/, "").trim();
  if (!trimmed) return { kind: "unknown", urls: [] };

  if (!trimmed.startsWith("<")) {
    const urls = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l));
    return urls.length ? { kind: "urlset", urls } : { kind: "unknown", urls: [] };
  }

  let root: DomElement | undefined;
  try {
    const $ = load(trimmed, { xml: true });
    root = $.root()
      .get(0)
      ?.children.find((c): c is DomElement => isElement(c));
  } catch {
    return { kind: "unknown", urls: [] };
  }
  if (!root) return { kind: "unknown", urls: [] };

  const name = localName(root);
  const kind: ParsedSitemap["kind"] = name === "sitemapindex" ? "index" : name === "urlset" ? "urlset" : "unknown";
  if (kind === "unknown") return { kind, urls: [] };

  const entryName = kind === "index" ? "sitemap" : "url";
  const urls: string[] = [];
  for (const entry of childElements(root)) {
    if (localName(entry) !== entryName) continue;
    const loc = locOf(entry);
    if (loc && !urls.includes(loc)) urls.push(loc);
  }
  return { kind, urls };
}

function sortChildren(children: string[]): string[] {
  const pages = children.filter((u) => PAGE_SITEMAP_RE.test(u));
  const rest = children.filter((u) => !PAGE_SITEMAP_RE.test(u));
  if (pages.length === 0) return rest;
  return [...pages, ...rest.filter((u) => !SECONDARY_SITEMAP_RE.test(u))];
}

/**
 * Walks robots sitemaps, then the usual default paths, breadth-first, up to
 * maxSitemaps files and maxUrls page URLs, same-site only. Gzipped sitemaps
 * are skipped.
 */
export async function discoverSitemapUrls(
  siteOrigin: string,
  robotsSitemaps: string[],
  opts: DiscoverSitemapOptions,
): Promise<DiscoveredSitemaps> {
  let origin: string;
  try {
    origin = new URL(siteOrigin).origin;
  } catch {
    return { urls: [], sitemapsRead: [] };
  }

  const urls: string[] = [];
  const urlSeen = new Set<string>();
  const sitemapsRead: string[] = [];
  const tried = new Set<string>();
  let attempts = 0;
  const maxAttempts = Math.max(opts.maxSitemaps, 1) * 2 + DEFAULT_SITEMAP_PATHS.length;

  const timeLeft = () => opts.deadline === undefined || opts.deadline - Date.now() >= MIN_REQUEST_MS;
  const budgetLeft = () =>
    sitemapsRead.length < opts.maxSitemaps && urls.length < opts.maxUrls && attempts < maxAttempts && timeLeft();

  const addUrl = (loc: string) => {
    if (urls.length >= opts.maxUrls) return;
    // The sitemap's own spelling is kept for fetching ("/about-us/"); the key ignores the slash.
    const n = normalizeUrl(loc, undefined, { keepTrailingSlash: true });
    if (!n || !isSameSite(n, origin) || !looksLikeHtmlPath(n)) return;
    const key = (urlKey(n) ?? n).toLowerCase();
    if (urlSeen.has(key)) return;
    urlSeen.add(key);
    urls.push(n);
  };

  const walk = async (start: string[]) => {
    const queue = [...start];
    while (queue.length && budgetLeft()) {
      const sitemapUrl = queue.shift();
      if (!sitemapUrl) continue;
      const key = sitemapUrl.toLowerCase();
      if (tried.has(key) || !isSameSite(sitemapUrl, origin) || /\.gz(\?|$)/i.test(sitemapUrl)) continue;
      tried.add(key);
      attempts++;

      const r = await fetchText(sitemapUrl, {
        userAgent: opts.userAgent,
        timeoutMs: opts.timeoutMs,
        maxBytes: MAX_SITEMAP_BYTES,
        fetchImpl: opts.fetchImpl,
        resolveHost: opts.resolveHost,
        deadline: opts.deadline,
        accept: "application/xml,text/xml;q=0.9,*/*;q=0.5",
        allowOffSite: true,
      });
      if (!r.ok || r.text === null) continue;
      const parsed = parseSitemap(r.text);
      if (parsed.kind === "unknown") continue;
      sitemapsRead.push(sitemapUrl);

      if (parsed.kind === "index") {
        const children = parsed.urls.filter((u) => isSameSite(u, origin) && !SKIP_SITEMAP_RE.test(u));
        for (const child of sortChildren(children)) if (!tried.has(child.toLowerCase())) queue.push(child);
      } else {
        for (const loc of parsed.urls) addUrl(loc);
      }
    }
  };

  const fromRobots = robotsSitemaps.filter((u) => isSameSite(u, origin));
  if (fromRobots.length) await walk(fromRobots);

  for (const path of DEFAULT_SITEMAP_PATHS) {
    if (urls.length > 0 || !budgetLeft()) break;
    await walk([`${origin}${path}`]);
  }

  return { urls, sitemapsRead };
}
