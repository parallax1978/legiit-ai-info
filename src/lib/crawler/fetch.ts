/*
  Thin fetch wrappers. Every request has a timeout, a byte cap, and an SSRF
  guard. The URL and every redirect hop are checked before they are
  requested (redirects are followed by hand), and the socket's own DNS
  lookup refuses private addresses, so the address checked is the address
  connected to: a domain that answers with a public address for a check and a
  private one for the connection gets nowhere. Nothing here throws: errors
  come back in the result so a step can record them and move on.
*/
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { isIpLiteral, isPrivateHost, isSameSite } from "./url";

/** Resolves a host name to the addresses it points at. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

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
  /**
   * A pre-request address check for an injected fetchImpl (tests). The default
   * fetch does not need it: its connect-time lookup refuses private addresses.
   */
  resolveHost?: ResolveHost;
  /** Epoch milliseconds. No request starts after it, and the timeout is cut to fit before it. */
  deadline?: number;
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

/** Redirect hops followed before giving up. */
export const MAX_REDIRECTS = 5;

/** With less time than this left before the deadline, a request is not started. */
export const MIN_REQUEST_MS = 1_000;

const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ---------------------------------------------------------------------------
// The guarded connection
// ---------------------------------------------------------------------------

/** The error code the connect-time lookup gives a host that resolves to a private address. */
export const PRIVATE_ADDRESS_CODE = "EPRIVATEADDRESS";

/**
 * A socket lookup that refuses private addresses. undici calls it when it
 * opens each connection, so every address the crawler connects to passes
 * through isPrivateHost; one private answer refuses the host.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  const opts: LookupOptions = { ...options, all: true };
  dnsLookup(hostname, opts, (err, result) => {
    if (err) {
      callback(err, "", 0);
      return;
    }
    const addresses = (Array.isArray(result) ? result : []) as LookupAddress[];
    if (!addresses.length) {
      callback(Object.assign(new Error(`${hostname} did not resolve`), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    if (addresses.some((a) => isPrivateHost(a.address))) {
      callback(Object.assign(new Error("private or local host"), { code: PRIVATE_ADDRESS_CODE }), "", 0);
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

let dispatcher: Dispatcher | null = null;

/**
 * The connection pool for crawler requests. In development, CRAWLER_PROXY_URL
 * routes requests through an HTTP proxy for sandboxes that need one; the proxy
 * resolves names itself, so the connect-time address check does not apply
 * there, and the setting is ignored in production.
 */
function crawlerDispatcher(): Dispatcher {
  if (dispatcher) return dispatcher;
  const proxy = process.env.NODE_ENV !== "production" ? process.env.CRAWLER_PROXY_URL : undefined;
  dispatcher = proxy ? new ProxyAgent(proxy) : new Agent({ connect: { lookup: guardedLookup } });
  return dispatcher;
}

/** fetch through the guarded pool. The default when no fetchImpl is given. */
const guardedFetch: typeof fetch = (input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: crawlerDispatcher(),
  }) as unknown as Promise<Response>;

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type TargetProblem = { kind: "invalid" | "private" | "dns"; message: string };

function checkUrl(url: string): TargetProblem | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "invalid", message: "invalid url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { kind: "invalid", message: "not an http(s) url" };
  if (isPrivateHost(u.hostname)) return { kind: "private", message: "private or local host" };
  return null;
}

/** The URL check plus, when a resolver is in play, the addresses the host points at. */
async function checkTarget(url: string, resolve: ResolveHost | null): Promise<TargetProblem | null> {
  const problem = checkUrl(url);
  if (problem || !resolve) return problem;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return null;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { kind: "dns", message: "the host name did not resolve" };
  }
  if (!addresses.length) return { kind: "dns", message: "the host name did not resolve" };
  // One private address is enough to refuse: the connection could land on it.
  if (addresses.some((a) => isPrivateHost(a))) return { kind: "private", message: "private or local host" };
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Bodies and errors
// ---------------------------------------------------------------------------

/**
 * A short, plain error. Connection failures report the error code only, never
 * the address or port, so nothing about the network a request reached is
 * stored or shown.
 */
function errorMessage(e: unknown, timeoutMs: number): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return `timeout after ${timeoutMs} ms`;
    const cause: unknown = "cause" in e ? e.cause : undefined;
    const code =
      cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" ? cause.code : null;
    if (code === PRIVATE_ADDRESS_CODE) return "private or local host";
    if (code) return `could not connect (${code})`;
    return e.message.replace(/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/g, "[address]");
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

/** The timeout for a request starting now: the configured one, cut to fit before the deadline. */
export function requestTimeout(opts: Pick<FetchPageOptions, "timeoutMs" | "deadline">, now = Date.now()): number {
  if (opts.deadline === undefined) return opts.timeoutMs;
  return Math.min(opts.timeoutMs, opts.deadline - now);
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * GET a text resource with a timeout and a byte cap. Redirects are followed by
 * hand, up to MAX_REDIRECTS, and every hop is checked before it is requested:
 * a hop to a private address is never requested, and an off-site hop is
 * reported instead of read unless allowOffSite.
 */
export async function fetchText(url: string, opts: FetchTextOptions): Promise<FetchTextResult> {
  const base: FetchTextResult = { ok: false, status: 0, finalUrl: url, text: null, contentType: null, bytes: 0 };
  const timeoutMs = requestTimeout(opts);
  if (timeoutMs < MIN_REQUEST_MS) return { ...base, error: "out of time for this step" };

  const fetchImpl = opts.fetchImpl ?? guardedFetch;
  const resolve = opts.resolveHost ?? null;
  // One timeout for the whole chain of hops and the body.
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = {
    "user-agent": opts.userAgent,
    accept: opts.accept ?? HTML_ACCEPT,
    "accept-language": "en-US,en;q=0.8",
  };

  let current = url;
  try {
    for (let hop = 0; ; hop++) {
      const problem = await checkTarget(current, resolve);
      if (problem) {
        if (hop === 0) return { ...base, error: problem.message };
        return {
          ...base,
          finalUrl: current,
          error: problem.kind === "private" ? "redirected to a private or local host" : `redirect failed: ${problem.message}`,
          redirectedOffSite: true,
        };
      }
      if (hop > 0 && !opts.allowOffSite && !isSameSite(url, current)) {
        return { ...base, finalUrl: current, error: `redirected off site to ${hostOf(current)}`, redirectedOffSite: true };
      }

      const res = await fetchImpl(current, { method: "GET", redirect: "manual", signal, headers });

      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location) return { ...base, status: res.status, finalUrl: current, error: `HTTP ${res.status} without a location` };
        if (hop >= MAX_REDIRECTS) return { ...base, status: res.status, finalUrl: current, error: "too many redirects" };
        let next: string;
        try {
          next = new URL(location, current).href;
        } catch {
          return { ...base, status: res.status, finalUrl: current, error: "the redirect location is not a valid address" };
        }
        current = next;
        continue;
      }
      if (res.type === "opaqueredirect") {
        return { ...base, finalUrl: current, error: "a redirect could not be followed" };
      }

      const contentType = res.headers.get("content-type");
      const result: FetchTextResult = { ...base, status: res.status, finalUrl: current, contentType };
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { ...result, error: `HTTP ${res.status}` };
      }

      const { data, bytes, truncated } = await readBody(res, opts.maxBytes);
      const text = decode(data, charsetOf(contentType, data));
      return { ...result, ok: true, text, bytes, truncated };
    }
  } catch (e) {
    return { ...base, finalUrl: current, error: errorMessage(e, timeoutMs) };
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
