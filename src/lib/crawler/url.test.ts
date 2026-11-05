import { describe, expect, it } from "vitest";
import { isPrivateHost, isSameSite, looksLikeHtmlPath, normalizeSiteUrl, normalizeUrl, parseIpv6, rankUrl, rankUrls } from "./url";

describe("normalizeSiteUrl", () => {
  it("accepts bare domains and variants", () => {
    expect(normalizeSiteUrl("example.com")).toBe("https://example.com/");
    expect(normalizeSiteUrl("  Example.COM/  ")).toBe("https://example.com/");
    expect(normalizeSiteUrl("http://www.example.com/")).toBe("https://www.example.com/");
    expect(normalizeSiteUrl("https://Example.com/path?x")).toBe("https://example.com/path");
    expect(normalizeSiteUrl("https://example.com/path/#about")).toBe("https://example.com/path");
    expect(normalizeSiteUrl("https://example.com:8443/en/")).toBe("https://example.com:8443/en");
  });

  it("rejects local, private, and non-http addresses", () => {
    expect(() => normalizeSiteUrl("localhost")).toThrow();
    expect(() => normalizeSiteUrl("http://localhost:3000")).toThrow();
    expect(() => normalizeSiteUrl("127.0.0.1")).toThrow();
    expect(() => normalizeSiteUrl("http://10.1.2.3/")).toThrow();
    expect(() => normalizeSiteUrl("http://192.168.1.1/")).toThrow();
    expect(() => normalizeSiteUrl("http://169.254.169.254/latest")).toThrow();
    expect(() => normalizeSiteUrl("http://[::1]/")).toThrow();
    expect(() => normalizeSiteUrl("ftp://example.com")).toThrow();
    expect(() => normalizeSiteUrl("mailto:hi@example.com")).toThrow();
    expect(() => normalizeSiteUrl("intranet")).toThrow();
    expect(() => normalizeSiteUrl("")).toThrow();
  });
});

describe("normalizeUrl", () => {
  it("drops hash and tracking params, lowercases the host, trims the slash", () => {
    expect(normalizeUrl("https://Example.com/About/?utm_source=x&utm_medium=y&page=2#top")).toBe("https://example.com/About?page=2");
    expect(normalizeUrl("https://example.com/about/?fbclid=abc")).toBe("https://example.com/about");
    expect(normalizeUrl("https://example.com:443/")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com/index.html")).toBe("https://example.com/");
  });

  it("resolves relative URLs against the base", () => {
    expect(normalizeUrl("/team/", "https://example.com/about/")).toBe("https://example.com/team");
    expect(normalizeUrl("pricing", "https://example.com/about/")).toBe("https://example.com/about/pricing");
    expect(normalizeUrl("#faq", "https://example.com/about")).toBe("https://example.com/about");
  });

  it("returns null for non-page schemes", () => {
    for (const bad of ["mailto:a@b.co", "tel:123", "javascript:void(0)", "data:text/html,hi", "ftp://x.com/a"]) {
      expect(normalizeUrl(bad, "https://example.com/")).toBeNull();
    }
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });
});

describe("isSameSite", () => {
  it("treats www and non-www as one site", () => {
    expect(isSameSite("https://www.example.com/a", "http://example.com/b")).toBe(true);
    expect(isSameSite("https://example.com", "https://shop.example.com")).toBe(false);
    expect(isSameSite("https://example.com", "https://example.org")).toBe(false);
    expect(isSameSite("nope", "https://example.com")).toBe(false);
  });
});

describe("looksLikeHtmlPath", () => {
  it("rejects assets, admin paths, archives, and noisy queries", () => {
    const bad = [
      "https://e.com/brochure.pdf",
      "https://e.com/img/logo.PNG",
      "https://e.com/style.css",
      "https://e.com/app.js",
      "https://e.com/sitemap.xml",
      "https://e.com/data.json",
      "https://e.com/font.woff2",
      "https://e.com/clip.mp4",
      "https://e.com/wp-admin/",
      "https://e.com/wp-json/wp/v2/pages",
      "https://e.com/feed/",
      "https://e.com/cart",
      "https://e.com/checkout/",
      "https://e.com/account/orders",
      "https://e.com/login",
      "https://e.com/tag/seo/",
      "https://e.com/category/news/",
      "https://e.com/blog/page/2/",
      "https://e.com/author/chris/",
      "https://e.com/post/?replytocom=12",
      "https://e.com/?s=hello",
      "https://e.com/shop/?add-to-cart=5",
      "https://e.com/x?a=1&b=2&c=3&d=4",
    ];
    for (const url of bad) expect(looksLikeHtmlPath(url), url).toBe(false);
  });

  it("accepts ordinary pages", () => {
    for (const url of ["https://e.com/", "https://e.com/about", "https://e.com/about.html", "https://e.com/team.php", "https://e.com/dr.smith", "https://e.com/?p=12"]) {
      expect(looksLikeHtmlPath(url), url).toBe(true);
    }
  });
});

describe("rankUrl", () => {
  it("orders home > about > team > contact > faq > pricing > services > locations > blog", () => {
    const order = [
      "https://e.com/",
      "https://e.com/about-us",
      "https://e.com/our-team",
      "https://e.com/contact",
      "https://e.com/faq",
      "https://e.com/pricing",
      "https://e.com/services",
      "https://e.com/locations",
      "https://e.com/blog",
    ];
    const scores = order.map((u) => rankUrl(u).score);
    for (let i = 1; i < scores.length; i++) expect(scores[i], order[i]).toBeLessThan(scores[i - 1]);
  });

  it("gives reasons and uses link text", () => {
    expect(rankUrl("https://e.com/").reason).toBe("home page");
    expect(rankUrl("https://e.com/about").reason).toBe("about page");
    expect(rankUrl("https://e.com/section-b", "Pricing").reason).toBe("pricing (link text)");
    expect(rankUrl("https://e.com/section-b").reason).toBe("page");
    expect(rankUrl("https://e.com/our-practice").reason).toBe("about page");
  });

  it("ranks careers low, blog posts lowest, and short paths above deep ones", () => {
    expect(rankUrl("https://e.com/join-our-team").score).toBeLessThan(rankUrl("https://e.com/anything").score);
    expect(rankUrl("https://e.com/blog/why-we-love-about-pages").score).toBeLessThan(rankUrl("https://e.com/careers").score);
    expect(rankUrl("https://e.com/2024/05/news-post").score).toBeLessThan(rankUrl("https://e.com/careers").score);
    expect(rankUrl("https://e.com/services").score).toBeGreaterThan(rankUrl("https://e.com/services/emdr/langley").score);
  });
});

describe("rankUrls", () => {
  it("dedupes, drops non-html and off-site, caps, and assigns ranks", () => {
    const ranked = rankUrls(
      [
        { url: "https://e.com/blog" },
        { url: "https://www.e.com/about/?utm_source=x" },
        { url: "https://e.com/about" },
        { url: "https://e.com/brochure.pdf" },
        { url: "https://other.com/about" },
        { url: "https://e.com/contact", text: "Contact us" },
        { url: "https://e.com/" },
        { url: "https://e.com/services" },
      ],
      { home: "https://e.com/", max: 4 },
    );
    expect(ranked.map((r) => r.url)).toEqual([
      "https://e.com/",
      "https://www.e.com/about",
      "https://e.com/contact",
      "https://e.com/services",
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([0, 1, 2, 3]);
    expect(ranked[0].reason).toBe("home page");
  });
});

describe("isPrivateHost with IPv6", () => {
  it("refuses IPv4-mapped addresses in both spellings", () => {
    expect(isPrivateHost("[::ffff:7f00:1]")).toBe(true);
    expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateHost("[::ffff:a9fe:a9fe]")).toBe(true);
    expect(isPrivateHost("::ffff:0a00:0005")).toBe(true);
  });

  it("refuses loopback, unspecified, link-local, unique local, multicast, and wrappers of private IPv4", () => {
    for (const host of ["::1", "::", "fe80::1", "fe80::1%eth0", "fd12:3456::1", "fc00::1", "ff02::1", "2002:0a00:0001::", "64:ff9b::808:808", "2001:db8::1", "::127.0.0.1"]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
  });

  it("allows public IPv6 addresses, including IPv4-mapped public ones", () => {
    expect(isPrivateHost("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateHost("[2a03:2880:f12f:83:face:b00c::25de]")).toBe(false);
    expect(isPrivateHost("::ffff:93.184.216.34")).toBe(false);
  });

  it("refuses anything with a colon that is not an IPv6 address", () => {
    expect(isPrivateHost("1:2:3:4:5:6:7:8:9")).toBe(true);
    expect(isPrivateHost("gg::1")).toBe(true);
  });

  it("parses compressed and embedded forms", () => {
    expect(parseIpv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIpv6("1::")).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6("a::b::c")).toBeNull();
  });

  it("makes normalizeSiteUrl refuse a mapped loopback address", () => {
    expect(() => normalizeSiteUrl("https://[::ffff:127.0.0.1]/")).toThrow();
    expect(() => normalizeSiteUrl("https://[::ffff:169.254.169.254]/")).toThrow();
  });
});
