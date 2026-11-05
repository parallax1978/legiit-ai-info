/*
  Thin fetch wrappers. Every request has a timeout, a byte cap, and a
  same-site check on redirects. Nothing here throws: errors come back in the
  result so a step can record them and move on.
*/
import { isPrivateHost, isSameSite } from "./url";

export type FetchResult = {
  ok: boolean;
  status: number;
  finalUrl: string;
  html: string | null;
  contentType: string | null;
  bytes: number;
  error?: string;
  redirectedOffSite?: boolean;
  /** The body was longer than maxBytes and was cut. */
  truncated?: boolean;
};

export type FetchPageOptions = {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  fetchImpl?: typeof fetch;
};

export type FetchTextOptions = FetchPageOptions & {
  /** Accept header; defaults to HTML. */
  accept?: string;
  /** Off-site redirects are refused for pages; sitemaps on a CDN host are fine. */
  allowOffSite?: boolean;
};

export type FetchTextResult = {
  ok: boolean;
  status: number;
  finalUrl: string;
  text: string | null;
  contentType: string | null;
  bytes: number;
  error?: string;
  redirectedOffSite?: boolean;
  truncated?: boolean;
};

const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5";

function errorMessage(e: unknown, timeoutMs: number): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return `timeout after ${timeoutMs} ms`;
    const cause = "cause" in e && e.cause instanceof Error ? `: ${e.cause.message}` : "";
    return `${e.message}${cause}`;
  }
  return String(e);
}

async function readBody(
  res: Response,
  maxBytes: number,
): Promise<{ data: Uint8Array; bytes: number; truncated: boolean }> {
  const body = res.body;
  if (!body) {
    const all = new Uint8Array(await res.arrayBuffer());
    return { data: all.subarray(0, maxBytes), bytes: all.length, truncated: all.length > maxBytes };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.length;
    if (bytes > maxBytes) {
      const keep = value.length - (bytes - maxBytes);
      if (keep > 0) chunks.push(value.subarray(0, keep));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  const data = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  return { data, bytes, truncated };
}

function charsetOf(contentType: string | null, head: Uint8Array): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  if (fromHeader) return fromHeader;
  const sniff = new TextDecoder("latin1").decode(head.subarray(0, 4096));
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(sniff)?.[1];
  return fromMeta ?? "utf-8";
}

function decode(data: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(data);
  } catch {
    return new TextDecoder("utf-8").decode(data);
  }
}

function checkUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "invalid url";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "not an http(s) url";
  if (isPrivateHost(u.hostname)) return "private or local host";
  return null;
}

/**
 * GET a text resource with a timeout and a byte cap. Follows redirects, and
 * reports an off-site redirect instead of reading it unless allowOffSite.
 */
export async function fetchText(url: string, opts: FetchTextOptions): Promise<FetchTextResult> {
  const base: FetchTextResult = { ok: false, status: 0, finalUrl: url, text: null, contentType: null, bytes: 0 };
  const problem = checkUrl(url);
  if (problem) return { ...base, error: problem };

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: {
        "user-agent": opts.userAgent,
        accept: opts.accept ?? HTML_ACCEPT,
        "accept-language": "en-US,en;q=0.8",
      },
    });

    const finalUrl = res.url || url;
    const contentType = res.headers.get("content-type");
    const result: FetchTextResult = { ...base, status: res.status, finalUrl, contentType };

    const finalProblem = finalUrl !== url ? checkUrl(finalUrl) : null;
    if (finalProblem) {
      await res.body?.cancel().catch(() => undefined);
      return { ...result, error: `redirected to a ${finalProblem}`, redirectedOffSite: true };
    }
    if (!opts.allowOffSite && !isSameSite(url, finalUrl)) {
      await res.body?.cancel().catch(() => undefined);
      return { ...result, error: `redirected off site to ${new URL(finalUrl).hostname}`, redirectedOffSite: true };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ...result, error: `HTTP ${res.status}` };
    }

    const { data, bytes, truncated } = await readBody(res, opts.maxBytes);
    const text = decode(data, charsetOf(contentType, data));
    return { ...result, ok: true, text, bytes, truncated };
  } catch (e) {
    return { ...base, error: errorMessage(e, opts.timeoutMs) };
  }
}

function isHtmlType(contentType: string | null, text: string): boolean {
  if (contentType) {
    const type = contentType.toLowerCase();
    return type.includes("text/html") || type.includes("application/xhtml+xml");
  }
  return /^\s*(﻿)?\s*</.test(text);
}

/**
 * Fetches one HTML page. Refuses non-HTML content types, caps the body at
 * maxBytes (truncated is set when cut), treats off-site redirects as skipped.
 */
export async function fetchPage(url: string, opts: FetchPageOptions): Promise<FetchResult> {
  const r = await fetchText(url, { ...opts, accept: HTML_ACCEPT });
  const result: FetchResult = {
    ok: false,
    status: r.status,
    finalUrl: r.finalUrl,
    html: null,
    contentType: r.contentType,
    bytes: r.bytes,
  };
  if (r.redirectedOffSite) result.redirectedOffSite = true;
  if (r.truncated) result.truncated = true;
  if (!r.ok || r.text === null) return { ...result, error: r.error ?? "fetch failed" };
  if (!isHtmlType(r.contentType, r.text)) {
    return { ...result, error: `not html (content type ${r.contentType ?? "missing"})` };
  }
  return { ...result, ok: true, html: r.text };
}
