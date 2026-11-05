import { describe, expect, it } from "vitest";
import { fetchPage, fetchText, requestTimeout } from "./fetch";
import { parseRobots } from "./robots";

const opts = { userAgent: "LegiitAiInfoBot/0.1", timeoutMs: 1000, maxBytes: 100_000 };

type Route = () => Response;

function html(body: string): Route {
  return () => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function redirect(location: string, status = 301): Route {
  return () => new Response(null, { status, headers: { location } });
}

/** A stub fetch that serves fixed routes and records every URL it was asked for. */
function routes(table: Record<string, Route>): { fetchImpl: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    expect(init?.redirect).toBe("manual");
    const route = table[url];
    return route ? route() : new Response("nope", { status: 404 });
  };
  return { fetchImpl, requested };
}

function respond(body: string, init: ResponseInit & { url?: string } = {}): typeof fetch {
  return async () => {
    const res = new Response(body, { status: init.status ?? 200, headers: init.headers ?? { "content-type": "text/html; charset=utf-8" } });
    if (init.url) Object.defineProperty(res, "url", { value: init.url });
    return res;
  };
}

describe("fetchPage", () => {
  it("returns html from a stubbed fetch", async () => {
    const r = await fetchPage("https://example.com/", { ...opts, fetchImpl: respond("<html><body>Hi</body></html>", { url: "https://example.com/" }) });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.html).toContain("Hi");
    expect(r.finalUrl).toBe("https://example.com/");
    expect(r.contentType).toContain("text/html");
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.truncated).toBeUndefined();
  });

  it("refuses non-html content types", async () => {
    const r = await fetchPage("https://example.com/doc.pdf", { ...opts, fetchImpl: respond("%PDF-1.4", { headers: { "content-type": "application/pdf" } }) });
    expect(r.ok).toBe(false);
    expect(r.html).toBeNull();
    expect(r.error).toContain("application/pdf");
  });

  it("sniffs html when the content type is missing", async () => {
    const noType: typeof fetch = async () => new Response(new TextEncoder().encode("<!doctype html><html></html>"));
    const r = await fetchPage("https://example.com/", { ...opts, fetchImpl: noType });
    expect(r.contentType).toBeNull();
    expect(r.ok).toBe(true);
  });

  it("returns an error on timeout instead of throwing", async () => {
    const aborting: typeof fetch = async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    };
    const r = await fetchPage("https://example.com/", { ...opts, fetchImpl: aborting });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("timeout");
    expect(r.status).toBe(0);
  });

  it("passes a timeout signal and our user agent to fetch", async () => {
    let seen: RequestInit | undefined;
    const spy: typeof fetch = async (_input, init) => {
      seen = init;
      return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    };
    await fetchPage("https://example.com/", { ...opts, fetchImpl: spy });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(seen?.headers).get("user-agent")).toBe("LegiitAiInfoBot/0.1");
  });

  it("flags truncation at maxBytes", async () => {
    const body = `<html><body>${"a".repeat(5000)}</body></html>`;
    const r = await fetchPage("https://example.com/", { ...opts, maxBytes: 1000, fetchImpl: respond(body) });
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.html?.length).toBe(1000);
    expect(r.bytes).toBe(body.length);
  });

  it("treats an off-site redirect as skipped without requesting it", async () => {
    const { fetchImpl, requested } = routes({
      "https://example.com/": redirect("https://parked.example.net/"),
      "https://parked.example.net/": html("<html>parked</html>"),
    });
    const r = await fetchPage("https://example.com/", { ...opts, fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.redirectedOffSite).toBe(true);
    expect(r.html).toBeNull();
    expect(requested).toEqual(["https://example.com/"]);
  });

  it("accepts a www redirect as the same site", async () => {
    const { fetchImpl } = routes({
      "https://example.com/about": redirect("https://www.example.com/about/"),
      "https://www.example.com/about/": html("<html>about</html>"),
    });
    const r = await fetchPage("https://example.com/about", { ...opts, fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.finalUrl).toBe("https://www.example.com/about/");
  });

  it("reports http errors", async () => {
    const r = await fetchPage("https://example.com/missing", { ...opts, fetchImpl: respond("<html>404</html>", { status: 404 }) });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.error).toBe("HTTP 404");
  });

  it("never fetches private hosts", async () => {
    let called = false;
    const spy: typeof fetch = async () => {
      called = true;
      return new Response("");
    };
    const r = await fetchPage("http://169.254.169.254/latest/meta-data", { ...opts, fetchImpl: spy });
    expect(called).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("private");
  });
});

describe("fetchPage with robots.txt", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /members/", "https://example.com", "LegiitAiInfoBot/0.1");

  it("never requests a page robots.txt disallows", async () => {
    const { fetchImpl, requested } = routes({ "https://example.com/members/": html("<html>members</html>") });
    const r = await fetchPage("https://example.com/members/", { ...opts, fetchImpl, allowed: robots.allowed });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("robots.txt disallows this page");
    expect(requested).toEqual([]);
  });

  it("does not follow a redirect into a disallowed page", async () => {
    const { fetchImpl, requested } = routes({
      "https://example.com/team": redirect("https://example.com/members/team/"),
      "https://example.com/members/team/": html("<html>team</html>"),
    });
    const r = await fetchPage("https://example.com/team", { ...opts, fetchImpl, allowed: robots.allowed });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("redirected to a page robots.txt disallows");
    expect(requested).toEqual(["https://example.com/team"]);
  });
});

describe("fetchText", () => {
  it("decodes the charset from the content type", async () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in latin1
    const fetchImpl: typeof fetch = async () => new Response(bytes, { headers: { "content-type": "text/plain; charset=iso-8859-1" } });
    const r = await fetchText("https://example.com/x.txt", { ...opts, fetchImpl, accept: "text/plain" });
    expect(r.text).toBe("café");
  });
});

describe("the SSRF guard", () => {
  it("never requests a redirect hop that points at a private address", async () => {
    const { fetchImpl, requested } = routes({
      "https://example.com/sitemap.xml": redirect("http://169.254.169.254/latest/meta-data/"),
    });
    const r = await fetchText("https://example.com/sitemap.xml", { ...opts, fetchImpl, allowOffSite: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("redirected to a private or local host");
    expect(r.status).toBe(0);
    expect(requested).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("refuses IPv4-mapped IPv6 hops in the hex form the URL parser produces", async () => {
    const { fetchImpl, requested } = routes({
      "https://example.com/": redirect("http://[::ffff:127.0.0.1]:8080/admin"),
    });
    const r = await fetchText("https://example.com/", { ...opts, fetchImpl, allowOffSite: true });
    expect(r.error).toBe("redirected to a private or local host");
    expect(requested).toHaveLength(1);
  });

  it("checks every hop, not only the last one", async () => {
    const { fetchImpl, requested } = routes({
      "https://example.com/a": redirect("https://example.com/b"),
      "https://example.com/b": redirect("http://10.0.0.5/do-something"),
      "http://10.0.0.5/do-something": redirect("https://example.com/ok"),
      "https://example.com/ok": html("<html>ok</html>"),
    });
    const r = await fetchPage("https://example.com/a", { ...opts, fetchImpl });
    expect(r.ok).toBe(false);
    expect(requested).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("refuses a host whose DNS points at a private address", async () => {
    const { fetchImpl, requested } = routes({ "https://internal.example.com/": html("<html>secret</html>") });
    const r = await fetchPage("https://internal.example.com/", {
      ...opts,
      fetchImpl,
      resolveHost: async () => ["93.184.216.34", "10.0.0.5"],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("private");
    expect(requested).toEqual([]);
  });

  it("allows a host with public IPv4 and IPv6 addresses", async () => {
    const { fetchImpl } = routes({ "https://example.com/": html("<html>hi</html>") });
    const r = await fetchPage("https://example.com/", {
      ...opts,
      fetchImpl,
      resolveHost: async () => ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
    });
    expect(r.ok).toBe(true);
  });

  it("reports a host that does not resolve without requesting it", async () => {
    const { fetchImpl, requested } = routes({});
    const r = await fetchPage("https://nowhere.example.com/", {
      ...opts,
      fetchImpl,
      resolveHost: async () => {
        throw new Error("getaddrinfo ENOTFOUND nowhere.example.com");
      },
    });
    expect(r.error).toBe("the host name did not resolve");
    expect(requested).toEqual([]);
  });

  it("stops after too many redirects", async () => {
    const table: Record<string, Route> = {};
    for (let i = 0; i < 10; i++) table[`https://example.com/${i}`] = redirect(`https://example.com/${i + 1}`);
    const { fetchImpl, requested } = routes(table);
    const r = await fetchPage("https://example.com/0", { ...opts, fetchImpl });
    expect(r.error).toBe("too many redirects");
    expect(requested).toHaveLength(6);
  });

  it("does not start a request past the deadline", async () => {
    const { fetchImpl, requested } = routes({ "https://example.com/": html("<html></html>") });
    const r = await fetchPage("https://example.com/", { ...opts, fetchImpl, deadline: Date.now() + 200 });
    expect(r.error).toBe("out of time for this step");
    expect(requested).toEqual([]);
  });

  it("cuts the timeout to fit before the deadline", () => {
    expect(requestTimeout({ timeoutMs: 10_000, deadline: 105_000 }, 100_000)).toBe(5_000);
    expect(requestTimeout({ timeoutMs: 10_000, deadline: 200_000 }, 100_000)).toBe(10_000);
    expect(requestTimeout({ timeoutMs: 10_000 }, 100_000)).toBe(10_000);
  });

  it("keeps addresses out of connection errors", async () => {
    const refused: typeof fetch = async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED 203.0.113.7:5432"), { code: "ECONNREFUSED" }),
      });
    };
    const r = await fetchPage("https://example.com/", { ...opts, fetchImpl: refused });
    expect(r.error).toBe("could not connect (ECONNREFUSED)");
  });
});
