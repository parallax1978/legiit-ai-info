import { config } from "@/config";

/*
  Helpers for the sign-in flow: the public origin of a request (for the links
  Supabase emails and the OAuth redirect) and a safe "continue to" path.
  Pure: no server-only imports, so the login page can use it too.
*/

const HOST_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/i;
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i;

/**
 * The origin the visitor used, from the proxy headers (x-forwarded-host and
 * x-forwarded-proto, else host). Falls back to the configured site URL when
 * the headers are missing or do not look like a host name.
 */
export function originFromHeaders(h: Headers): string {
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!host || !HOST_RE.test(host)) return config.site.url;

  const forwardedProto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  const proto = forwardedProto || (LOCAL_HOST_RE.test(host) ? "http" : "https");
  if (proto !== "http" && proto !== "https") return config.site.url;

  return `${proto}://${host}`;
}

const PROBE_ORIGIN = "http://next.invalid";

/**
 * A same-site path to continue to after sign-in, as pathname plus query.
 * The value is parsed the way a browser and the URL API parse it, so tricks
 * the parser undoes (a tab or newline the parser strips, backslashes it reads
 * as slashes, "//host") resolve to a different origin and become the
 * fallback. Control characters are refused outright.
 */
export function safeNext(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== PROBE_ORIGIN) return fallback;
  return `${parsed.pathname}${parsed.search}`;
}

/** The absolute URL for a safe next path on this origin; never leaves the origin. */
export function nextUrl(next: string, origin: string): URL {
  const base = new URL(origin);
  const target = new URL(safeNext(next), base);
  return target.origin === base.origin ? target : new URL("/app", base);
}
