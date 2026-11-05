import { describe, expect, it } from "vitest";
import { fetchRobots, parseRobots, userAgentToken } from "./robots";

const UA = "LegiitAiInfoBot/0.1 (+https://legiitaiinfo.com/bot)";

function serve(body: string | null, contentType = "text/plain"): typeof fetch {
  return async () =>
    body === null ? new Response("nope", { status: 404 }) : new Response(body, { status: 200, headers: { "content-type": contentType } });
}

const opts = { userAgent: UA, timeoutMs: 1000 };

describe("fetchRobots", () => {
  it("applies a disallow rule for * and reads sitemap lines", async () => {
    const robots = await fetchRobots("https://example.com", {
      ...opts,
      fetchImpl: serve("User-agent: *\nDisallow: /private/\nCrawl-delay: 2\n\nSitemap: https://example.com/sitemap.xml\nSitemap: /page-sitemap.xml\n"),
    });
    expect(robots.raw).toContain("Disallow: /private/");
    expect(robots.allowed("https://example.com/private/x")).toBe(false);
    expect(robots.allowed("https://www.example.com/private/x")).toBe(false);
    expect(robots.allowed("http://example.com/private/")).toBe(false);
    expect(robots.allowed("https://example.com/about")).toBe(true);
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml", "https://example.com/page-sitemap.xml"]);
    expect(robots.crawlDelayMs).toBe(2000);
  });

  it("prefers the group for our token over *", async () => {
    const robots = await fetchRobots("https://example.com", {
      ...opts,
      fetchImpl: serve("User-agent: LegiitAiInfoBot\nDisallow: /secret/\n\nUser-agent: *\nDisallow: /\n"),
    });
    expect(robots.allowed("https://example.com/secret/x")).toBe(false);
    expect(robots.allowed("https://example.com/about")).toBe(true);
  });

  it("allows everything when robots.txt is missing or is an html page", async () => {
    const missing = await fetchRobots("https://example.com", { ...opts, fetchImpl: serve(null) });
    expect(missing.raw).toBeNull();
    expect(missing.allowed("https://example.com/anything")).toBe(true);
    expect(missing.sitemaps).toEqual([]);

    const html = await fetchRobots("https://example.com", { ...opts, fetchImpl: serve("<html><body>404</body></html>", "text/html") });
    expect(html.raw).toBeNull();
    expect(html.allowed("https://example.com/anything")).toBe(true);
  });

  it("allows everything when the fetch fails", async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const robots = await fetchRobots("https://example.com", { ...opts, fetchImpl: failing });
    expect(robots.allowed("https://example.com/x")).toBe(true);
  });
});

describe("parseRobots", () => {
  it("rebuilds the check from stored text", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /tmp/", "https://example.com", UA);
    expect(robots.allowed("https://example.com/tmp/a")).toBe(false);
    expect(robots.allowed("https://example.com/")).toBe(true);
    expect(parseRobots(null, "https://example.com", UA).allowed("https://example.com/tmp/a")).toBe(true);
  });

  it("derives the token from the user agent", () => {
    expect(userAgentToken(UA)).toBe("LegiitAiInfoBot");
  });
});
