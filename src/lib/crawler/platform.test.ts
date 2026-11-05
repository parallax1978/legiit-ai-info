import { describe, expect, it } from "vitest";
import { detectPlatform, mergePlatformEvidence, readGenerator } from "./platform";

const url = "https://example.com/";

describe("detectPlatform", () => {
  it("finds WordPress from the generator and asset paths", () => {
    const html = `<html><head><meta name="generator" content="WordPress 6.5" /><link href="/wp-content/themes/x/style.css"></head><body><script src="/wp-includes/js/jquery.js"></script></body></html>`;
    const r = detectPlatform(html, url);
    expect(r.platform).toBe("wordpress");
    expect(r.evidence.map((e) => e.signal)).toEqual([
      "wordpress: meta generator",
      "wordpress: wp-content asset path",
      "wordpress: wp-includes asset path",
    ]);
    expect(r.evidence[0]).toEqual({ signal: "wordpress: meta generator", value: "WordPress 6.5", url });
  });

  it("finds Shopify from the CDN and theme object", () => {
    const html = `<html><body><img src="https://cdn.shopify.com/s/files/1/0001/x.png"><script>Shopify.theme = {"name":"Dawn"};</script></body></html>`;
    const r = detectPlatform(html, url);
    expect(r.platform).toBe("shopify");
    expect(r.evidence.some((e) => e.signal === "shopify: Shopify CDN asset")).toBe(true);
    expect(r.evidence.some((e) => e.signal === "shopify: Shopify.theme script")).toBe(true);
  });

  it("finds Wix from the generator and parastorage", () => {
    const html = `<html><head><meta content="Wix.com Website Builder" name="generator"></head><body><script src="https://static.parastorage.com/x.js"></script></body></html>`;
    const r = detectPlatform(html, url, { generator: "Wix.com Website Builder" });
    expect(r.platform).toBe("wix");
    expect(r.evidence).toHaveLength(2);
  });

  it("finds Squarespace from the CDN", () => {
    const html = `<html><body><script src="https://static1.squarespace.com/static/x.js"></script></body></html>`;
    expect(detectPlatform(html, url).platform).toBe("squarespace");
  });

  it("finds Webflow from data-wf attributes and assets", () => {
    const html = `<html data-wf-page="abc" data-wf-site="def"><body><img src="https://assets-global.website-files.com/x.png"></body></html>`;
    const r = detectPlatform(html, url);
    expect(r.platform).toBe("webflow");
    expect(r.evidence).toHaveLength(3);
  });

  it("returns other for plain html and unknown for no document", () => {
    expect(detectPlatform("<html><body>Hi</body></html>", url)).toEqual({ platform: "other", evidence: [] });
    expect(detectPlatform("", url)).toEqual({ platform: "unknown", evidence: [] });
    const joomla = detectPlatform(`<html><head><meta name="generator" content="Joomla! - Open Source CMS"></head></html>`, url);
    expect(joomla.platform).toBe("other");
    expect(joomla.evidence[0].signal).toBe("other: meta generator");
  });

  it("reads the generator without a parse", () => {
    expect(readGenerator(`<meta content='Squarespace' name='generator'>`)).toBe("Squarespace");
    expect(readGenerator(`<meta name="viewport" content="width=device-width">`)).toBeNull();
  });
});

describe("mergePlatformEvidence", () => {
  const wp = detectPlatform(`<html><link href="/wp-content/x.css"></html>`, url);
  const other = detectPlatform(`<html><body>plain</body></html>`, url);
  const unknown = detectPlatform("", url);
  const shopify = detectPlatform(`<html><img src="https://cdn.shopify.com/a.png"><div class="shopify-section"></div></html>`, url);

  it("picks the platform with the most evidence", () => {
    expect(mergePlatformEvidence([wp, shopify, wp]).platform).toBe("wordpress");
    expect(mergePlatformEvidence([wp, shopify]).platform).toBe("shopify");
  });

  it("lets a named platform beat other, and other beat unknown", () => {
    expect(mergePlatformEvidence([other, other, other, wp]).platform).toBe("wordpress");
    expect(mergePlatformEvidence([unknown, unknown, other]).platform).toBe("other");
    expect(mergePlatformEvidence([unknown, unknown]).platform).toBe("unknown");
    expect(mergePlatformEvidence([])).toEqual({ platform: "unknown", evidence: [] });
  });

  it("returns the winner's evidence, deduped", () => {
    const merged = mergePlatformEvidence([wp, wp, shopify]);
    expect(merged.platform).toBe("wordpress");
    expect(merged.evidence).toHaveLength(1);
    expect(merged.evidence[0].signal).toBe("wordpress: wp-content asset path");
  });
});
