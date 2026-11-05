import { describe, expect, it } from "vitest";
import { config } from "@/config";
import { cleanPage, collectTypes, parseJsonLd } from "./clean";

const PAGE = `<!doctype html><html lang="en-CA"><head>
<meta charset="utf-8"><title>Darcy Bailey &amp; Associates | Counselling in Langley</title>
<meta name="description" content="Counselling for children, teens, adults, couples and families in Langley, BC.">
<meta name="generator" content="WordPress 6.5.2">
<meta property="og:image" content="/wp-content/uploads/og.jpg">
<link rel="canonical" href="https://www.example.com/about/">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Darcy Bailey","founder":{"@type":"Person","name":"Darcy"}},{"@type":"WebSite"}]}</script>
<script type="application/ld+json">{"@type": "LocalBusiness", "name": "Broken",}</script>
<script>var secretScriptValue = 1;</script>
<style>.styleRuleText{color:red}</style>
</head><body class="home page">
<div id="cookie-banner" class="cc-banner">We use cookies on this site. <button>Accept</button></div>
<header class="site-header"><a href="/" class="custom-logo-link"><img src="/wp-content/uploads/header-brand.png" alt="Darcy Bailey &amp; Associates"></a>
<nav><ul><li><a href="/about/">About</a></li><li><a href="/services/">Navigation Item Zeta</a></li></ul></nav>
<a href="tel:+1 (604) 533-9163">Call 604-533-9163</a></header>
<main>
<article><header class="entry-header"><h1>About Darcy Bailey &amp; Associates</h1></header>
<p>We are a “team of 14 therapists” in Langley,&nbsp;BC. It’s pay per session.</p>
<h2>Services</h2>
<ul><li>Adult counselling</li><li>Couples <b>and</b> marriage counselling</li></ul>
<table><tr><th>Session</th><th>Fee</th></tr><tr><td>50 minutes</td><td>$195</td></tr></table>
<div aria-hidden="true">×</div>
<img src="/wp-content/uploads/2024/05/canadian-choice-award-2024.png" alt="">
<img src="/images/bbb-accredited-business.png" alt="BBB Accredited Business">
<img class="site-logo" src="/images/mark.png" alt="">
<img src="/images/team.jpg" alt="The team">
<h3>Contact</h3>
<p>Email <a href="mailto:Hello@Example.com?subject=Hi">hello@example.com</a> or
<a href="https://www.facebook.com/darcybailey">Facebook</a>,
<a href="https://twitter.com/darcybailey">Twitter</a>,
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>,
<a href="https://www.linkedin.com/shareArticle?mini=true&url=x">Share on LinkedIn</a>,
<a href="https://maps.app.goo.gl/abc">Map</a>,
<a href="https://www.psychologytoday.com/ca/therapists/x">Psychology Today</a>,
<a href="https://www.yelp.ca/biz/x">Yelp</a>.</p>
<a href="/team/">Meet the team</a> <a href="/pricing/?utm_source=x#top">Pricing</a> <a href="https://www.example.com/faq/">FAQ</a> <a href="/brochure.pdf">PDF</a>
</article>
</main>
<div class="social-share"><a href="https://twitter.com/intent/tweet?text=x">Tweet</a></div>
<footer class="site-footer"><p>&copy; 2024 Darcy Bailey &amp; Associates Counselling Ltd. All rights reserved.</p><p>#205 - 20644 Fraser Hwy, Langley, BC V3A 4G5</p><p>Mon to Fri 9am to 8pm</p><a href="/privacy/">Footer Privacy Link</a></footer>
</body></html>`;

const page = cleanPage(PAGE, "https://example.com/about/");

describe("cleanPage head", () => {
  it("reads the head", () => {
    expect(page.title).toBe("Darcy Bailey & Associates | Counselling in Langley");
    expect(page.metaDescription).toContain("Counselling for children");
    expect(page.canonical).toBe("https://www.example.com/about/");
    expect(page.lang).toBe("en-CA");
    expect(page.generator).toBe("WordPress 6.5.2");
    expect(page.ogImage).toBe("https://example.com/wp-content/uploads/og.jpg");
  });
});

describe("cleanPage text", () => {
  it("strips nav, footer links, scripts, styles, and the cookie banner", () => {
    expect(page.text).not.toContain("Navigation Item Zeta");
    expect(page.text).not.toContain("Footer Privacy Link");
    expect(page.text).not.toContain("secretScriptValue");
    expect(page.text).not.toContain("styleRuleText");
    expect(page.text).not.toContain("We use cookies");
    expect(page.text).not.toContain("×");
  });

  it("keeps the fact lines from the footer under a marker", () => {
    const tail = page.text.slice(page.text.indexOf("Footer:"));
    expect(tail).toContain("© 2024 Darcy Bailey & Associates Counselling Ltd.");
    expect(tail).toContain("#205 - 20644 Fraser Hwy, Langley, BC V3A 4G5");
    expect(tail).toContain("Mon to Fri 9am to 8pm");
  });

  it("keeps headings with # prefixes and lists them", () => {
    expect(page.text).toContain("# About Darcy Bailey & Associates");
    expect(page.text).toContain("## Services");
    expect(page.text).toContain("### Contact");
    expect(page.headings).toEqual([
      { level: 1, text: "About Darcy Bailey & Associates" },
      { level: 2, text: "Services" },
      { level: 3, text: "Contact" },
    ]);
  });

  it("prefixes list items and joins table rows", () => {
    expect(page.text).toContain("- Adult counselling");
    expect(page.text).toContain("- Couples and marriage counselling");
    expect(page.text).toContain("Session | Fee");
    expect(page.text).toContain("50 minutes | $195");
  });

  it("straightens curly quotes and non-breaking spaces", () => {
    expect(page.text).toContain('We are a "team of 14 therapists" in Langley, BC. It\'s pay per session.');
    expect(page.text).not.toMatch(/[‘’“” ]/);
  });

  it("counts characters", () => {
    expect(page.textChars).toBe(page.text.length);
  });

  it("caps the text with a trailing marker", () => {
    const paragraphs = Array.from({ length: 800 }, (_, i) => `<p>Paragraph ${i} says the practice has been open since 2008 and sees families from Langley.</p>`).join("");
    const long = cleanPage(`<html><body><main>${paragraphs}</main></body></html>`, "https://example.com/");
    expect(long.text.length).toBeLessThanOrEqual(config.crawl.maxPageTextChars);
    expect(long.text.endsWith("[truncated]")).toBe(true);
    expect(long.textChars).toBe(long.text.length);
  });
});

describe("cleanPage links", () => {
  it("normalizes tel and mailto", () => {
    expect(page.links.tel).toEqual(["+16045339163"]);
    expect(page.links.mailto).toEqual(["hello@example.com"]);
  });

  it("classifies social links and ignores share links", () => {
    expect(page.links.social).toEqual([
      { platform: "facebook", url: "https://www.facebook.com/darcybailey", text: "Facebook" },
      { platform: "x", url: "https://twitter.com/darcybailey", text: "Twitter" },
    ]);
    expect(page.links.maps).toEqual(["https://maps.app.goo.gl/abc"]);
    expect(page.links.reviews).toEqual([
      { site: "psychologytoday", url: "https://www.psychologytoday.com/ca/therapists/x" },
      { site: "yelp", url: "https://www.yelp.ca/biz/x" },
    ]);
  });

  it("collects internal links with text, normalized and deduped", () => {
    const internal = page.links.internal ?? [];
    expect(internal).toContainEqual({ url: "https://example.com/team", text: "Meet the team" });
    expect(internal).toContainEqual({ url: "https://example.com/pricing", text: "Pricing" });
    expect(internal).toContainEqual({ url: "https://www.example.com/faq", text: "FAQ" });
    expect(internal.filter((l) => l.url.endsWith("/about")).length).toBe(1);
    expect(internal.some((l) => l.url.endsWith(".pdf"))).toBe(false);
  });
});

describe("cleanPage JSON-LD", () => {
  it("parses a valid block and collects nested and @graph types", () => {
    expect(page.jsonld[0].error).toBeUndefined();
    expect(page.jsonld[0].types).toEqual(["Organization", "Person", "WebSite"]);
    expect(page.jsonld[0].data).toMatchObject({ "@context": "https://schema.org" });
  });

  it("keeps a broken block with its error", () => {
    expect(page.jsonld[1].data).toBeNull();
    expect(page.jsonld[1].error).toBeTruthy();
    expect(page.jsonld[1].raw).toContain("Broken");
    expect(page.jsonld[1].types).toEqual([]);
  });

  it("tolerates comment wrappers", () => {
    const block = parseJsonLd('<!-- {"@type":"Organization"} -->');
    expect(block.data).toEqual({ "@type": "Organization" });
    expect(collectTypes(block.data)).toEqual(["Organization"]);
  });
});

describe("cleanPage images", () => {
  it("flags the header home-link image and a class logo", () => {
    const logos = page.images.filter((i) => i.kind === "logo");
    expect(logos.map((i) => i.src)).toEqual([
      "https://example.com/wp-content/uploads/header-brand.png",
      "https://example.com/images/mark.png",
    ]);
    expect(logos[0].reason).toContain("home link");
    expect(logos[1].reason).toContain("class");
  });

  it("flags an award from the file name with empty alt", () => {
    const award = page.images.find((i) => i.src.endsWith("canadian-choice-award-2024.png"));
    expect(award).toMatchObject({ kind: "award", alt: "" });
    expect(award?.reason).toContain("file name");
  });

  it("flags a membership badge and leaves the rest as other", () => {
    expect(page.images.find((i) => i.src.includes("bbb"))?.kind).toBe("badge");
    expect(page.images.find((i) => i.src.includes("team.jpg"))?.kind).toBe("other");
  });

  it("puts logos and awards first", () => {
    const kinds = page.images.map((i) => i.kind);
    expect(kinds.indexOf("other")).toBeGreaterThan(kinds.lastIndexOf("award"));
  });

  it("keeps an inline svg logo only inside a home link", () => {
    const html = `<html><body><header><a href="/"><svg><title>Acme</title></svg></a><a href="/about"><svg></svg></a></header></body></html>`;
    const p = cleanPage(html, "https://acme.com/");
    expect(p.images).toEqual([{ src: "inline-svg", alt: "Acme", kind: "logo", reason: expect.stringContaining("home") }]);
  });
});
