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

describe("discoverSite with home page links", () => {
  it("adds the pages the home page links to, even when the sitemap only lists profiles", async () => {
    const HOME = `<html><body><header><nav>
      <a href="/about-legiit">About</a><a href="/faq">FAQ</a><a href="/contact-us">Contact us</a>
      <a href="https://twitter.com/legiit">Twitter</a></nav></header>
      <main><p>Welcome</p></main></body></html>`;
    const PROFILES = `<urlset>${["EP", "ev", "kd", "Jo", "NT"].map((s) => `<url><loc>https://legiit.com/${s}</loc></url>`).join("")}</urlset>`;
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://legiit.com/") return new Response(HOME, { headers: { "content-type": "text/html" } });
      if (url === "https://legiit.com/sitemap.xml") return new Response(PROFILES, { headers: { "content-type": "application/xml" } });
      return new Response("nope", { status: 404 });
    };
    const result = await discoverSite("https://legiit.com/", { ...opts, maxPages: 5, fetchImpl });
    expect(result.usedSitemap).toBe(true);
    expect(result.queue.map((q) => q.url)).toEqual([
      "https://legiit.com/",
      "https://legiit.com/about-legiit",
      "https://legiit.com/contact-us",
      "https://legiit.com/faq",
      expect.stringMatching(/^https:\/\/legiit\.com\/(EP|ev|kd|Jo|NT)$/),
    ]);
  });

  it("does not fetch the home page when robots.txt disallows it", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requested.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
      return new Response("nope", { status: 404 });
    };
    await discoverSite("https://example.com/", { ...opts, fetchImpl });
    expect(requested).not.toContain("https://example.com/");
  });
});

describe("discoverSite probes for key pages it cannot see", () => {
  it("finds /about on a site whose home page renders in the browser", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requested.push(url);
      if (url === "https://app.example.com/") return new Response("<html><body><div id=root></div></body></html>", { headers: { "content-type": "text/html" } });
      if (url === "https://app.example.com/about") return new Response("<html><body><h1>About</h1></body></html>", { headers: { "content-type": "text/html" } });
      // Everything else bounces to the home page, as a client-side router would.
      if (!url.endsWith(".txt") && !url.endsWith(".xml")) return new Response(null, { status: 302, headers: { location: "https://app.example.com/" } });
      return new Response("nope", { status: 404 });
    };
    const result = await discoverSite("https://app.example.com/", { ...opts, maxPages: 10, fetchImpl });
    expect(result.queue.map((q) => q.url)).toEqual(["https://app.example.com/", "https://app.example.com/about"]);
    expect(requested).toContain("https://app.example.com/team");
  });

  it("does not probe when the key pages are already known", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requested.push(url);
      if (url === "https://example.com/robots.txt") return new Response(ROBOTS, { headers: { "content-type": "text/plain" } });
      if (url === "https://example.com/sitemap.xml") return new Response(
        `<urlset>${["/about", "/our-team", "/contact", "/faq", "/pricing"].map((p) => `<url><loc>https://example.com${p}</loc></url>`).join("")}</urlset>`,
        { headers: { "content-type": "application/xml" } },
      );
      return new Response("nope", { status: 404 });
    };
    await discoverSite("https://example.com/", { ...opts, maxPages: 10, fetchImpl });
    expect(requested.filter((u) => /\/(about-us|team|contact-us|faqs)$/.test(u))).toEqual([]);
  });
});

describe("discoverSite on a WordPress site with plain permalinks", () => {
  it("queues the ?page_id= pages from the sitemap and the home page links", async () => {
    const HOME = '<html><body><nav><a href="/?page_id=2">About Us</a><a href="/?page_id=5">Services</a><a href="/?page_id=7">Contact</a></nav><main><p>Hi</p></main></body></html>';
    const SITEMAP = `<urlset>${["/", "/?page_id=2", "/?page_id=5", "/?page_id=7", "/?page_id=9"].map((p) => `<url><loc>https://plainwp.example.com${p.replace(/&/g, "&amp;")}</loc></url>`).join("")}</urlset>`;
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://plainwp.example.com/") return new Response(HOME, { headers: { "content-type": "text/html" } });
      if (url === "https://plainwp.example.com/robots.txt") return new Response("Sitemap: https://plainwp.example.com/wp-sitemap.xml\n", { headers: { "content-type": "text/plain" } });
      if (url === "https://plainwp.example.com/wp-sitemap.xml") return new Response(SITEMAP, { headers: { "content-type": "application/xml" } });
      return new Response("nope", { status: 404 });
    };
    const result = await discoverSite("https://plainwp.example.com/", { ...opts, maxPages: 10, fetchImpl });
    expect(result.usedSitemap).toBe(true);
    expect(result.queue.map((q) => q.url)).toEqual(
      expect.arrayContaining([
        "https://plainwp.example.com/?page_id=2",
        "https://plainwp.example.com/?page_id=5",
        "https://plainwp.example.com/?page_id=7",
        "https://plainwp.example.com/?page_id=9",
      ]),
    );
  });

  it("follows links when the sitemap lists nothing crawlable", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://e2.example.com/sitemap.xml") return new Response("<urlset><url><loc>https://e2.example.com/brochure.pdf</loc></url></urlset>", { headers: { "content-type": "application/xml" } });
      return new Response("nope", { status: 404 });
    };
    const result = await discoverSite("https://e2.example.com/", { ...opts, fetchImpl });
    expect(result.usedSitemap).toBe(false);
  });
});
