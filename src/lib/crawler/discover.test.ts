import { describe, expect, it } from "vitest";
import { addDiscoveredLinks, discoverSite } from "./discover";
import { parseRobots } from "./robots";

const ROBOTS = "User-agent: *\nDisallow: /private/\nSitemap: https://example.com/sitemap.xml\n";
const SITEMAP = `<urlset>
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/private/notes/</loc></url>
  <url><loc>https://example.com/blog/post/</loc></url>
  <url><loc>https://example.com/about/</loc></url>
  <url><loc>https://example.com/contact/</loc></url>
</urlset>`;

function stubFetch(routes: Record<string, string>): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = routes[url];
    if (body === undefined) return new Response("nope", { status: 404 });
    const type = url.endsWith("robots.txt") ? "text/plain" : "application/xml";
    return new Response(body, { status: 200, headers: { "content-type": type } });
  };
}

const opts = { userAgent: "LegiitAiInfoBot/0.1", timeoutMs: 1000, maxPages: 3, maxSitemaps: 5, maxSitemapUrls: 100 };

describe("discoverSite", () => {
  it("builds a ranked queue from robots and the sitemap, home first, robots-blocked URLs dropped and listed", async () => {
    const result = await discoverSite("Example.com", {
      ...opts,
      fetchImpl: stubFetch({ "https://example.com/robots.txt": ROBOTS, "https://example.com/sitemap.xml": SITEMAP }),
    });
    expect(result.home).toBe("https://example.com/");
    expect(result.robots.raw).toBe(ROBOTS);
    expect(result.robots.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(result.sitemapsRead).toEqual(["https://example.com/sitemap.xml"]);
    expect(result.usedSitemap).toBe(true);
    expect(result.blockedByRobots).toEqual(["https://example.com/private/notes"]);
    expect(result.queue).toEqual([
      { url: "https://example.com/", rank: 0, reason: "home page" },
      { url: "https://example.com/about", rank: 1, reason: "about page" },
      { url: "https://example.com/contact", rank: 2, reason: "contact page" },
    ]);
  });

  it("falls back to the home page alone when there is no sitemap", async () => {
    const result = await discoverSite("https://www.example.com/", { ...opts, fetchImpl: stubFetch({}) });
    expect(result.usedSitemap).toBe(false);
    expect(result.robots.raw).toBeNull();
    expect(result.queue).toEqual([{ url: "https://www.example.com/", rank: 0, reason: "home page" }]);
    expect(result.blockedByRobots).toEqual([]);
  });

  it("rejects a private address", async () => {
    await expect(discoverSite("http://127.0.0.1/", { ...opts, fetchImpl: stubFetch({}) })).rejects.toThrow();
  });
});

describe("addDiscoveredLinks", () => {
  const home = "https://example.com/";
  const queue = [{ url: "https://example.com/", rank: 0, reason: "home page" }];

  it("ranks new links, skips seen and queued ones, caps, and continues the ranks", () => {
    const added = addDiscoveredLinks(
      queue,
      ["https://example.com/blog"],
      [
        { url: "/", text: "Home" },
        { url: "/blog/", text: "Blog" },
        { url: "/services/", text: "Services" },
        { url: "/about-us/", text: "About" },
        { url: "/team/#staff", text: "Meet the team" },
        { url: "/brochure.pdf", text: "Brochure" },
        { url: "https://other.com/", text: "Partner" },
        { url: "mailto:hi@example.com", text: "Email" },
      ],
      { home, max: 2 },
    );
    expect(added).toEqual([
      { url: "https://example.com/about-us", rank: 1, reason: "about page" },
      { url: "https://example.com/team", rank: 2, reason: "team page" },
    ]);
  });

  it("applies the robots check and an explicit next rank", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /team/", home, "LegiitAiInfoBot/0.1");
    const added = addDiscoveredLinks(queue, [], [{ url: "/team/" }, { url: "/pricing/" }], {
      home,
      max: 5,
      nextRank: 7,
      allowed: robots.allowed,
    });
    expect(added).toEqual([{ url: "https://example.com/pricing", rank: 7, reason: "pricing page" }]);
  });

  it("returns nothing when there is no room", () => {
    expect(addDiscoveredLinks(queue, [], [{ url: "/about/" }], { home, max: 0 })).toEqual([]);
  });
});

describe("discoverSite with a blocking robots.txt", () => {
  it("drops the home page too and reports it, leaving an empty queue", async () => {
    const result = await discoverSite("https://example.com/", {
      ...opts,
      fetchImpl: stubFetch({ "https://example.com/robots.txt": "User-agent: *\nDisallow: /\n" }),
    });
    expect(result.queue).toEqual([]);
    expect(result.blockedByRobots).toEqual(["https://example.com/"]);
  });
});
