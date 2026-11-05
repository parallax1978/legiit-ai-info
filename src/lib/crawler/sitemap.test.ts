import { describe, expect, it } from "vitest";
import { discoverSitemapUrls, parseSitemap } from "./sitemap";

const INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/page-sitemap.xml</loc><lastmod>2024-05-01</lastmod></sitemap>
  <sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap>
  <sitemap><loc>https://example.com/category-sitemap.xml</loc></sitemap>
  <sitemap><loc>https://cdn.other.com/sitemap.xml</loc></sitemap>
</sitemapindex>`;

const PAGES = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about/</loc></url>
  <url><loc>https://example.com/contact/</loc></url>
  <url><loc>https://other.com/elsewhere/</loc></url>
  <url><loc>https://example.com/brochure.pdf</loc></url>
</urlset>`;

const POSTS = `<urlset><url><loc>https://example.com/blog/post-one/</loc></url><url><loc>https://example.com/blog/post-two/</loc></url></urlset>`;

function stubFetch(routes: Record<string, string | number>): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const hit = routes[url];
    if (hit === undefined) return new Response("not found", { status: 404 });
    if (typeof hit === "number") return new Response("", { status: hit });
    return new Response(hit, { status: 200, headers: { "content-type": "application/xml" } });
  };
}

const opts = { userAgent: "LegiitAiInfoBot/0.1", timeoutMs: 1000, maxSitemaps: 10, maxUrls: 100 };

describe("parseSitemap", () => {
  it("reads an index", () => {
    const parsed = parseSitemap(INDEX);
    expect(parsed.kind).toBe("index");
    expect(parsed.urls).toHaveLength(4);
    expect(parsed.urls[0]).toBe("https://example.com/page-sitemap.xml");
  });

  it("reads a urlset", () => {
    const parsed = parseSitemap(PAGES);
    expect(parsed.kind).toBe("urlset");
    expect(parsed.urls).toContain("https://example.com/about/");
    expect(parsed.urls).toHaveLength(5);
  });

  it("returns unknown for garbage", () => {
    expect(parseSitemap("")).toEqual({ kind: "unknown", urls: [] });
    expect(parseSitemap("<html><body>404</body></html>")).toEqual({ kind: "unknown", urls: [] });
    expect(parseSitemap("<<<not xml")).toEqual({ kind: "unknown", urls: [] });
    expect(parseSitemap("just some words")).toEqual({ kind: "unknown", urls: [] });
  });

  it("reads a plain text sitemap", () => {
    expect(parseSitemap("https://example.com/a\nhttps://example.com/b\n")).toEqual({
      kind: "urlset",
      urls: ["https://example.com/a", "https://example.com/b"],
    });
  });
});

describe("discoverSitemapUrls", () => {
  const routes = {
    "https://example.com/sitemap.xml": INDEX,
    "https://example.com/page-sitemap.xml": PAGES,
    "https://example.com/post-sitemap.xml": POSTS,
    "https://example.com/category-sitemap.xml": POSTS,
  };

  it("walks the index, reads page sitemaps first, skips post and category sitemaps, keeps same-site html only", async () => {
    const result = await discoverSitemapUrls("https://example.com", [], { ...opts, fetchImpl: stubFetch(routes) });
    expect(result.sitemapsRead).toEqual(["https://example.com/sitemap.xml", "https://example.com/page-sitemap.xml"]);
    expect(result.urls).toEqual(["https://example.com/", "https://example.com/about", "https://example.com/contact"]);
  });

  it("uses the robots sitemaps first", async () => {
    const result = await discoverSitemapUrls("https://example.com", ["https://example.com/page-sitemap.xml"], {
      ...opts,
      fetchImpl: stubFetch(routes),
    });
    expect(result.sitemapsRead).toEqual(["https://example.com/page-sitemap.xml"]);
    expect(result.urls).toHaveLength(3);
  });

  it("reads post sitemaps when there is no page sitemap", async () => {
    const index = `<sitemapindex><sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap></sitemapindex>`;
    const result = await discoverSitemapUrls("https://example.com", [], {
      ...opts,
      fetchImpl: stubFetch({ "https://example.com/sitemap.xml": index, "https://example.com/post-sitemap.xml": POSTS }),
    });
    expect(result.urls).toEqual(["https://example.com/blog/post-one", "https://example.com/blog/post-two"]);
  });

  it("respects maxSitemaps", async () => {
    const result = await discoverSitemapUrls("https://example.com", [], { ...opts, maxSitemaps: 1, fetchImpl: stubFetch(routes) });
    expect(result.sitemapsRead).toEqual(["https://example.com/sitemap.xml"]);
    expect(result.urls).toEqual([]);
  });

  it("respects maxUrls", async () => {
    const result = await discoverSitemapUrls("https://example.com", [], { ...opts, maxUrls: 2, fetchImpl: stubFetch(routes) });
    expect(result.urls).toHaveLength(2);
  });

  it("falls through the default paths and returns nothing when there is no sitemap", async () => {
    const result = await discoverSitemapUrls("https://example.com", [], { ...opts, fetchImpl: stubFetch({}) });
    expect(result).toEqual({ urls: [], sitemapsRead: [] });
  });
});

describe("discoverSitemapUrls with a deadline", () => {
  it("stops walking when the deadline passes and keeps what it found", async () => {
    const urlset = (paths: string[]) =>
      `<urlset>${paths.map((p) => `<url><loc>https://example.com${p}</loc></url>`).join("")}</urlset>`;
    const index = `<sitemapindex>${Array.from({ length: 8 }, (_, i) => `<sitemap><loc>https://example.com/page-sitemap${i}.xml</loc></sitemap>`).join("")}</sitemapindex>`;
    let clock = 0;
    const deadline = 10_000;
    const realNow = Date.now;
    Date.now = () => clock;
    try {
      const fetchImpl: typeof fetch = async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        clock += 3_000; // every sitemap takes three seconds
        if (url.endsWith("/sitemap.xml")) return new Response(index, { headers: { "content-type": "application/xml" } });
        const n = /page-sitemap(\d)/.exec(url)?.[1] ?? "x";
        return new Response(urlset([`/page-${n}`]), { headers: { "content-type": "application/xml" } });
      };
      const result = await discoverSitemapUrls("https://example.com", [], {
        userAgent: "LegiitAiInfoBot/0.1",
        timeoutMs: 10_000,
        maxSitemaps: 12,
        maxUrls: 100,
        fetchImpl,
        deadline,
      });
      expect(result.sitemapsRead.length).toBeLessThan(9);
      expect(result.urls.length).toBeGreaterThan(0);
      expect(clock).toBeLessThanOrEqual(deadline + 3_000);
    } finally {
      Date.now = realNow;
    }
  });
});
