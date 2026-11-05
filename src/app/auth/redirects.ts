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

/**
 * A same-site path to continue to after sign-in. Anything that is not a plain
 * absolute path (an external URL, a protocol-relative URL, header injection)
 * becomes the fallback.
 */
export function safeNext(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n\0]/.test(value)) return fallback;
  return value;
}
