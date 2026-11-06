import { describe, expect, it, vi } from "vitest";
import type { FactSheetData } from "@/lib/facts/types";
import {
  SHARE_LINK_DAYS,
  isShareLinkLive,
  isShareToken,
  newShareToken,
  notFoundPage,
  pageResponseHeaders,
  shareExpiresAt,
  shareUrl,
  zipFileName,
  zipFilesFor,
  type ZipSource,
} from "./share";

// The module is server-only (it reads the database with the service client);
// the pure parts tested here do not touch it.
vi.mock("server-only", () => ({}));

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe("newShareToken", () => {
  it("is 24 random bytes as base64url: 32 characters, no padding", () => {
    const token = newShareToken();
    expect(token).toHaveLength(32);
    expect(token).toMatch(BASE64URL);
    expect(token).not.toContain("=");
    expect(isShareToken(token)).toBe(true);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newShareToken()));
    expect(tokens.size).toBe(200);
  });
});

describe("isShareToken", () => {
  it("accepts base64url of a sane length and nothing else", () => {
    expect(isShareToken("abcDEF012_-abcDEF012_-abcDEF012_")).toBe(true);
    expect(isShareToken("a".repeat(16))).toBe(true);
    expect(isShareToken("a".repeat(128))).toBe(true);
    expect(isShareToken("")).toBe(false);
    expect(isShareToken("short")).toBe(false);
    expect(isShareToken("a".repeat(129))).toBe(false);
    expect(isShareToken("abcDEF012_-abcDEF012_-abcDEF012=")).toBe(false);
    expect(isShareToken("abcDEF012_-abcDEF012_-abcDEF012/")).toBe(false);
    expect(isShareToken("abcDEF012_-abcDEF012_-abcDEF 12_")).toBe(false);
    expect(isShareToken("../../etc/passwd-abcDEF012_-abc")).toBe(false);
  });
});

describe("shareExpiresAt", () => {
  it("is 30 days after now, as an ISO timestamp", () => {
    expect(SHARE_LINK_DAYS).toBe(30);
    expect(shareExpiresAt(new Date("2026-11-06T12:00:00.000Z"))).toBe("2026-12-06T12:00:00.000Z");
    expect(shareExpiresAt(new Date("2026-12-20T00:00:00.000Z"))).toBe("2027-01-19T00:00:00.000Z");
  });

  it("defaults to now", () => {
    const before = Date.now();
    const t = Date.parse(shareExpiresAt());
    const days = SHARE_LINK_DAYS * 24 * 60 * 60 * 1000;
    expect(t).toBeGreaterThanOrEqual(before + days);
    expect(t).toBeLessThanOrEqual(Date.now() + days);
  });
});

describe("isShareLinkLive", () => {
  const now = new Date("2026-11-06T12:00:00.000Z");

  it("is live before its expiry and dead from the expiry on", () => {
    expect(isShareLinkLive({ expires_at: "2026-11-06T12:00:01.000Z" }, now)).toBe(true);
    expect(isShareLinkLive({ expires_at: "2026-12-06T12:00:00.000Z" }, now)).toBe(true);
    expect(isShareLinkLive({ expires_at: "2026-11-06T12:00:00.000Z" }, now)).toBe(false);
    expect(isShareLinkLive({ expires_at: "2026-11-05T12:00:00.000Z" }, now)).toBe(false);
  });

  it("never expires without an expiry, and is dead with an unreadable one", () => {
    expect(isShareLinkLive({ expires_at: null }, now)).toBe(true);
    expect(isShareLinkLive({ expires_at: "not a date" }, now)).toBe(false);
  });

  it("reads a PostgreSQL timestamptz with an offset", () => {
    expect(isShareLinkLive({ expires_at: "2026-12-06 12:00:00+00" }, now)).toBe(true);
    expect(isShareLinkLive({ expires_at: "2026-11-01 12:00:00+00" }, now)).toBe(false);
  });
});

describe("shareUrl", () => {
  it("is origin + /s/ + token", () => {
    expect(shareUrl("https://legiitaiinfo.com", "abc")).toBe("https://legiitaiinfo.com/s/abc");
    expect(shareUrl("https://legiitaiinfo.com/", "abc")).toBe("https://legiitaiinfo.com/s/abc");
    expect(shareUrl("http://localhost:3000//", "abc")).toBe("http://localhost:3000/s/abc");
  });
});

describe("zipFileName", () => {
  it("names the download after the site host", () => {
    expect(zipFileName("legiit.com")).toBe("legiit.com-about-page.zip");
    expect(zipFileName("www.darcybaileycounselling.com")).toBe("darcybaileycounselling.com-about-page.zip");
    expect(zipFileName("https://www.example.co.uk")).toBe("example.co.uk-about-page.zip");
  });

  it("keeps the name safe for a Content-Disposition header", () => {
    expect(zipFileName('evil"; filename="x.exe')).toBe("evil-filename-x.exe-about-page.zip");
    expect(zipFileName("Ünïcode Host")).toBe("n-code-host-about-page.zip");
    expect(zipFileName(" .-weird-. ")).toBe("weird-about-page.zip");
    expect(zipFileName("x".repeat(300))).toHaveLength(100 + "-about-page.zip".length);
  });

  it("falls back without a host", () => {
    expect(zipFileName(null)).toBe("about-page.zip");
    expect(zipFileName(undefined)).toBe("about-page.zip");
    expect(zipFileName("")).toBe("about-page.zip");
    expect(zipFileName("...")).toBe("about-page.zip");
  });
});

describe("zipFilesFor", () => {
  const sheet: FactSheetData = { templateId: "about-v1", fields: {} };
  const generation: ZipSource = {
    page_html: "<!doctype html><html><body><h1>About Legiit</h1></body></html>",
    wordpress_html: "<script type=\"application/ld+json\">{}</script><article></article>",
    schema: { "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Legiit" }] },
    instructions_md: "# Install the About page for Legiit\n",
  };

  it("lists the five files in order with pretty JSON", () => {
    const files = zipFilesFor(generation, sheet);
    expect(files.map((f) => f.name)).toEqual([
      "about.html",
      "about-wordpress.html",
      "schema.json",
      "instructions.md",
      "fact-sheet.json",
    ]);
    expect(files[0].data).toBe(generation.page_html);
    expect(files[1].data).toBe(generation.wordpress_html);
    expect(files[2].data).toBe(`${JSON.stringify(generation.schema, null, 2)}\n`);
    expect(files[2].data).toContain('\n  "@graph": [');
    expect(files[3].data).toBe(generation.instructions_md);
    expect(files[4].data).toBe(`${JSON.stringify(sheet, null, 2)}\n`);
    expect(JSON.parse(files[4].data)).toEqual(sheet);
  });

  it("leaves out what is not there", () => {
    const files = zipFilesFor({ page_html: "<p>x</p>", wordpress_html: null, schema: null, instructions_md: null }, null);
    expect(files.map((f) => f.name)).toEqual(["about.html"]);
  });

  it("pretty-prints a schema stored as JSON text", () => {
    const files = zipFilesFor({ ...generation, schema: '{"@context":"https://schema.org","@graph":[]}' }, null);
    const schema = files.find((f) => f.name === "schema.json");
    expect(schema?.data).toBe('{\n  "@context": "https://schema.org",\n  "@graph": []\n}\n');
  });
});

describe("pageResponseHeaders", () => {
  it("serves html that is not indexed, not shared-cached, and cannot run scripts", () => {
    const headers = pageResponseHeaders();
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(headers["x-robots-tag"]).toBe("noindex");
    expect(headers["cache-control"]).toContain("private");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-security-policy"]).not.toContain("script-src 'self'");
    // The page carries inline preview styles and https images.
    expect(headers["content-security-policy"]).toContain("style-src 'unsafe-inline'");
    expect(headers["content-security-policy"]).toContain("img-src https:");
  });

  it("is a fresh object each time", () => {
    const a = pageResponseHeaders();
    a["x-robots-tag"] = "index";
    expect(pageResponseHeaders()["x-robots-tag"]).toBe("noindex");
  });
});

describe("notFoundPage", () => {
  it("is a small noindex html page that says the link is gone", () => {
    const html = notFoundPage();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("expired or was removed");
    expect(html).not.toContain("<script");
  });
});
