import { describe, expect, it } from "vitest";
import { fetchPage, fetchText } from "./fetch";

const opts = { userAgent: "LegiitAiInfoBot/0.1", timeoutMs: 1000, maxBytes: 100_000 };

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

  it("treats an off-site redirect as skipped", async () => {
    const r = await fetchPage("https://example.com/", { ...opts, fetchImpl: respond("<html></html>", { url: "https://parked.example.net/" }) });
    expect(r.ok).toBe(false);
    expect(r.redirectedOffSite).toBe(true);
    expect(r.html).toBeNull();
  });

  it("accepts a www redirect as the same site", async () => {
    const r = await fetchPage("https://example.com/about", { ...opts, fetchImpl: respond("<html></html>", { url: "https://www.example.com/about/" }) });
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

describe("fetchText", () => {
  it("decodes the charset from the content type", async () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in latin1
    const fetchImpl: typeof fetch = async () => new Response(bytes, { headers: { "content-type": "text/plain; charset=iso-8859-1" } });
    const r = await fetchText("https://example.com/x.txt", { ...opts, fetchImpl, accept: "text/plain" });
    expect(r.text).toBe("café");
  });
});
