/*
  Discovery: the one-step phase that turns a site URL into a ranked fetch
  queue, plus the helper the fetch phase uses to grow the queue from on-page
  links when there is no sitemap.
*/
import type { ResolveHost } from "./fetch";
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

  const sitemap = await discoverSitemapUrls(origin, robots.sitemaps, {
    userAgent: opts.userAgent,
    timeoutMs: opts.timeoutMs,
    maxSitemaps: opts.maxSitemaps,
    maxUrls: opts.maxSitemapUrls,
    fetchImpl: opts.fetchImpl,
    resolveHost: opts.resolveHost,
    deadline: opts.deadline,
  });

  const candidates: UrlCandidate[] = [{ url: home }, ...sitemap.urls.map((url) => ({ url }))];
  const ranked = rankUrls(candidates, { home, max: Number.MAX_SAFE_INTEGER });

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
