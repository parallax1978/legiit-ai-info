/*
  Discovery: the one-step phase that turns a site URL into a ranked fetch
  queue, plus the helper the fetch phase uses to grow the queue from on-page
  links when there is no sitemap.
*/
import { cleanPage } from "./clean";
import { fetchPage, fetchText, type ResolveHost } from "./fetch";
import { fetchRobots } from "./robots";
import { discoverSitemapUrls } from "./sitemap";
import {
  isSameSite,
  looksLikeHtmlPath,
  normalizeSiteUrl,
  normalizeUrl,
  rankUrls,
  urlKey,
  type RankedUrl,
  type UrlCandidate,
} from "./url";

export type DiscoverOptions = {
  userAgent: string;
  timeoutMs: number;
  maxPages: number;
  maxSitemaps: number;
  maxSitemapUrls: number;
  fetchImpl?: typeof fetch;
  resolveHost?: ResolveHost;
  /**
   * Epoch milliseconds. robots.txt and the sitemap walk stop here and the
   * queue is built from what was found, so discovery fits in one step even on
   * a host that never answers.
   */
  deadline?: number;
};

export type DiscoveryResult = {
  home: string;
  robots: { raw: string | null; sitemaps: string[]; crawlDelayMs?: number };
  sitemapsRead: string[];
  usedSitemap: boolean;
  queue: RankedUrl[];
  blockedByRobots: string[];
};

/**
 * Normalizes the site URL, reads robots.txt and the sitemaps, ranks the URLs,
 * and drops what robots disallows, the home page included. A site whose
 * robots.txt blocks everything comes back with an empty queue and the home
 * page in blockedByRobots, and the caller fails the run with that reason.
 */
export async function discoverSite(siteUrl: string, opts: DiscoverOptions): Promise<DiscoveryResult> {
  const home = normalizeSiteUrl(siteUrl);
  const origin = new URL(home).origin;

  const robots = await fetchRobots(origin, {
    userAgent: opts.userAgent,
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
    resolveHost: opts.resolveHost,
    deadline: opts.deadline,
  });

  // The home page's own links (navigation, footer, body) are the best signal for which pages
  // matter, and they carry link text. Sitemaps often list only products, posts, or profiles.
  const fromHome = robots.allowed(home) ? await homeLinks(home, opts) : [];

  const sitemap = await discoverSitemapUrls(origin, robots.sitemaps, {
    userAgent: opts.userAgent,
    timeoutMs: opts.timeoutMs,
    maxSitemaps: opts.maxSitemaps,
    maxUrls: opts.maxSitemapUrls,
    fetchImpl: opts.fetchImpl,
    resolveHost: opts.resolveHost,
    deadline: opts.deadline,
  });

  const candidates: UrlCandidate[] = [{ url: home }, ...fromHome, ...sitemap.urls.map((url) => ({ url }))];
  let ranked = rankUrls(candidates, { home, max: Number.MAX_SAFE_INTEGER });

  // A site whose pages render in the browser can link its About page from nowhere a crawler
  // sees. When a key page is missing, try the paths people type.
  const probed = await probeCommonPaths(home, ranked, robots.allowed, opts);
  if (probed.length) ranked = rankUrls([...candidates, ...probed], { home, max: Number.MAX_SAFE_INTEGER });

  const blockedByRobots: string[] = [];
  const kept: RankedUrl[] = [];
  for (const entry of ranked) {
    if (robots.allowed(entry.url)) kept.push(entry);
    else blockedByRobots.push(entry.url);
  }

  const queue = kept.slice(0, Math.max(1, opts.maxPages)).map((entry, rank) => ({ ...entry, rank }));

  return {
    home,
    robots: {
      raw: robots.raw,
      sitemaps: robots.sitemaps,
      ...(robots.crawlDelayMs !== undefined ? { crawlDelayMs: robots.crawlDelayMs } : {}),
    },
    sitemapsRead: sitemap.sitemapsRead,
    usedSitemap: sitemap.urls.length > 0,
    queue,
    blockedByRobots,
  };
}

/** The paths tried for each kind of key page that discovery did not find, in order. */
export const COMMON_PATHS: { reason: string; paths: string[] }[] = [
  { reason: "about", paths: ["/about", "/about-us", "/our-story"] },
  { reason: "team", paths: ["/team", "/our-team"] },
  { reason: "contact", paths: ["/contact", "/contact-us"] },
  { reason: "faq", paths: ["/faq", "/faqs"] },
  { reason: "pricing", paths: ["/pricing"] },
];

const PROBE_MAX_BYTES = 200_000;

/**
 * For each kind of key page with no candidate yet, tries its common paths
 * (robots permitting) and keeps the first that answers with an HTML page at
 * that path. A redirect to the home page, or to another path, does not count.
 */
async function probeCommonPaths(
  home: string,
  ranked: RankedUrl[],
  allowed: (url: string) => boolean,
  opts: DiscoverOptions,
): Promise<UrlCandidate[]> {
  const origin = new URL(home).origin;
  const known = new Set(ranked.map((r) => urlKey(r.url)));
  const missing = COMMON_PATHS.filter((g) => !ranked.some((r) => r.reason.startsWith(g.reason)));
  if (!missing.length) return [];

  const found = await Promise.all(
    missing.map(async (group) => {
      for (const path of group.paths) {
        const url = `${origin}${path}`;
        if (known.has(urlKey(url)) || !allowed(url)) continue;
        const r = await fetchText(url, {
          userAgent: opts.userAgent,
          timeoutMs: opts.timeoutMs,
          maxBytes: PROBE_MAX_BYTES,
          fetchImpl: opts.fetchImpl,
          resolveHost: opts.resolveHost,
          deadline: opts.deadline,
        });
        const landed = r.ok ? normalizeUrl(r.finalUrl) : null;
        const isHtml = /html/i.test(r.contentType ?? "");
        if (landed && isHtml && new URL(landed).pathname !== "/" && urlKey(landed) === urlKey(url)) {
          return { url: landed, text: group.reason };
        }
      }
      return null;
    }),
  );
  return found.filter((c): c is { url: string; text: string } => c !== null);
}

/** Max HTML read from the home page while discovering. */
const HOME_MAX_BYTES = 1_500_000;

/** The internal links on the home page, with their text. Empty when the page cannot be read. */
async function homeLinks(home: string, opts: DiscoverOptions): Promise<UrlCandidate[]> {
  const r = await fetchPage(home, {
    userAgent: opts.userAgent,
    timeoutMs: opts.timeoutMs,
    maxBytes: HOME_MAX_BYTES,
    fetchImpl: opts.fetchImpl,
    resolveHost: opts.resolveHost,
    deadline: opts.deadline,
  });
  if (!r.ok || !r.html) return [];
  try {
    const cleaned = cleanPage(r.html, r.finalUrl || home);
    return (cleaned.links.internal ?? []).map((l) => (l.text ? { url: l.url, text: l.text, fromHome: true } : { url: l.url, fromHome: true }));
  } catch {
    return [];
  }
}

export type AddLinksOptions = {
  home: string;
  /** How many new entries may be added (the page cap minus what is planned already). */
  max: number;
  /** Rank for the first new entry; defaults to one past the highest rank in the queue. */
  nextRank?: number;
  /** robots check, from parseRobots(run.robots.raw, ...). */
  allowed?: (url: string) => boolean;
};

/**
 * Ranks the internal links from a fetched page that are not yet in the queue
 * or in `seen`, drops what robots disallows, caps, and returns the new
 * entries with ranks assigned. The caller appends them to the queue and adds
 * their URLs to `seen`.
 */
export function addDiscoveredLinks(
  queue: RankedUrl[],
  seen: Iterable<string>,
  links: UrlCandidate[],
  opts: AddLinksOptions,
): RankedUrl[] {
  if (opts.max <= 0) return [];

  const known = new Set<string>();
  for (const url of seen) {
    const key = urlKey(url);
    if (key) known.add(key);
  }
  let highestRank = -1;
  for (const entry of queue) {
    const key = urlKey(entry.url);
    if (key) known.add(key);
    if (entry.rank > highestRank) highestRank = entry.rank;
  }

  const candidates: UrlCandidate[] = [];
  for (const link of links) {
    const n = normalizeUrl(link.url, opts.home);
    if (!n || !isSameSite(n, opts.home) || !looksLikeHtmlPath(n)) continue;
    const key = urlKey(n);
    if (!key || known.has(key)) continue;
    candidates.push(link.text ? { url: n, text: link.text } : { url: n });
  }

  const ranked = rankUrls(candidates, { home: opts.home, max: Number.MAX_SAFE_INTEGER })
    .filter((entry) => (opts.allowed ? opts.allowed(entry.url) : true))
    .slice(0, opts.max);

  const start = opts.nextRank ?? highestRank + 1;
  return ranked.map((entry, i) => ({ ...entry, rank: start + i }));
}
