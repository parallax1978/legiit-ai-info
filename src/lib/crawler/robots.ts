/*
  robots.txt: fetch, parse, and answer "may we fetch this URL" for our user
  agent token (LegiitAiInfoBot), falling back to the "*" group. A missing or
  unreadable robots.txt allows everything.
*/
import robotsParser from "robots-parser";
import { fetchText } from "./fetch";

export type RobotsResult = {
  allowed: (url: string) => boolean;
  sitemaps: string[];
  raw: string | null;
  crawlDelayMs?: number;
};

export type FetchRobotsOptions = {
  userAgent: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

const MAX_ROBOTS_BYTES = 512_000;

/** "LegiitAiInfoBot/0.1 (+https://...)" -> "LegiitAiInfoBot". */
export function userAgentToken(userAgent: string): string {
  return userAgent.split("/")[0]?.trim() || userAgent;
}

const allowAll: RobotsResult = { allowed: () => true, sitemaps: [], raw: null };

/**
 * Builds the allow check from stored robots text, so a later step can rebuild
 * it from crawl_runs.robots without fetching again. Null text allows all.
 */
export function parseRobots(raw: string | null, siteOrigin: string, userAgent: string): RobotsResult {
  if (raw === null) return allowAll;
  let origin: string;
  try {
    origin = new URL(siteOrigin).origin;
  } catch {
    return { ...allowAll, raw };
  }
  const robotsUrl = `${origin}/robots.txt`;
  const robot = robotsParser(robotsUrl, raw);
  const token = userAgentToken(userAgent);

  const sitemaps: string[] = [];
  for (const s of robot.getSitemaps()) {
    try {
      const u = new URL(s.trim(), robotsUrl);
      if ((u.protocol === "http:" || u.protocol === "https:") && !sitemaps.includes(u.href)) sitemaps.push(u.href);
    } catch {
      // not a URL; skip
    }
  }

  const delay = robot.getCrawlDelay(token);
  const result: RobotsResult = {
    raw,
    sitemaps,
    allowed: (url: string) => {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return false;
      }
      // The parser only answers for its own origin; www and scheme variants of the site count as ours.
      // Normalized URLs have no trailing slash, and a rule like "Disallow: /team/" must still apply,
      // so both spellings are checked and either one disallowed blocks the URL.
      const paths = [u.pathname];
      if (!u.pathname.endsWith("/")) paths.push(`${u.pathname}/`);
      return paths.every((path) => robot.isAllowed(`${origin}${path}${u.search}`, token) !== false);
    },
  };
  if (typeof delay === "number" && Number.isFinite(delay) && delay > 0) result.crawlDelayMs = Math.round(delay * 1000);
  return result;
}

export async function fetchRobots(siteOrigin: string, opts: FetchRobotsOptions): Promise<RobotsResult> {
  let robotsUrl: string;
  try {
    robotsUrl = new URL("/robots.txt", siteOrigin).href;
  } catch {
    return allowAll;
  }

  const r = await fetchText(robotsUrl, {
    userAgent: opts.userAgent,
    timeoutMs: opts.timeoutMs,
    maxBytes: MAX_ROBOTS_BYTES,
    fetchImpl: opts.fetchImpl,
    accept: "text/plain,*/*;q=0.8",
  });
  if (!r.ok || r.text === null) return allowAll;
  // A 200 that is really the site's HTML error page is not a robots file.
  if (/^\s*(﻿)?\s*</.test(r.text)) return allowAll;
  return parseRobots(r.text, siteOrigin, opts.userAgent);
}
