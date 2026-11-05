/*
  Runs the real crawler (discovery, fetch, cleaning, platform detection) on
  live sites, with no database and no model calls, and writes what it would
  read to smoke-crawl-report.txt: the ranked queue with reasons, and for the
  top pages the title, platform, JSON-LD types, contact links, logo and award
  images, and the start and end of the cleaned text.

    SITES=https://example.com,https://other.example pnpm smoke:crawl

  Use it to check what a scan will pick on a client's site before spending
  model tokens, or after changing the ranking or cleaning rules.
*/
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { config } from "@/config";
import { cleanPage, detectPlatform, discoverSite, fetchPage } from "@/lib/crawler";

const SITES = (process.env.SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const PAGES = Number(process.env.PAGES ?? 6);

it("crawls the sites in SITES", async () => {
  if (!SITES.length) throw new Error("Set SITES to a comma-separated list of site URLs.");
  const out: string[] = [];
  for (const site of SITES) {
    const t0 = Date.now();
    const d = await discoverSite(site, {
      userAgent: config.crawl.userAgent,
      timeoutMs: config.crawl.fetchTimeoutMs,
      maxPages: config.crawl.maxPages,
      maxSitemaps: config.crawl.maxSitemaps,
      maxSitemapUrls: config.crawl.maxSitemapUrls,
      deadline: Date.now() + config.crawl.discoverBudgetMs,
    });
    out.push(
      `\n#### ${site}  ${Date.now() - t0} ms  sitemap=${d.usedSitemap}  sitemaps read=${d.sitemapsRead.length}  queue=${d.queue.length}  blocked by robots=${d.blockedByRobots.length}`,
    );
    for (const q of d.queue) out.push(`  ${String(q.rank).padStart(2)}  ${q.reason.padEnd(30)} ${q.url}`);

    const top = d.queue.slice(0, PAGES);
    const fetched = await Promise.all(
      top.map((q) =>
        fetchPage(q.url, {
          userAgent: config.crawl.userAgent,
          timeoutMs: config.crawl.fetchTimeoutMs,
          maxBytes: config.crawl.maxHtmlBytes,
        }),
      ),
    );
    for (let i = 0; i < top.length; i++) {
      const r = fetched[i];
      out.push(`\n--- ${top[i].url}  ${r.status} ${r.ok ? "ok" : `failed: ${r.error}`}  ${r.bytes} bytes`);
      if (!r.ok || !r.html) continue;
      const c = cleanPage(r.html, r.finalUrl);
      const p = detectPlatform(r.html, r.finalUrl, { generator: c.generator });
      out.push(`title: ${c.title ?? "(none)"}  platform: ${p.platform}  text: ${c.textChars} chars, ${c.headings.length} headings`);
      out.push(`json-ld: ${c.jsonld.map((b) => (b.error ? `broken (${b.error.slice(0, 40)})` : b.types.join("+"))).join(" | ") || "none"}`);
      out.push(`tel: ${(c.links.tel ?? []).join(", ") || "none"}  mailto: ${(c.links.mailto ?? []).join(", ") || "none"}`);
      out.push(`social: ${(c.links.social ?? []).map((s) => `${s.platform} ${s.url}`).join(", ") || "none"}`);
      const flagged = c.images.filter((im) => im.kind !== "other");
      out.push(`images: ${flagged.map((im) => `${im.kind} (${im.reason}) ${im.src}`).join("\n        ") || "none flagged"}`);
      out.push(`text, first 1,200 characters:\n${c.text.slice(0, 1200)}`);
      out.push(`text, last 400 characters:\n${c.text.slice(-400)}`);
    }
  }
  writeFileSync("smoke-crawl-report.txt", out.join("\n"));
});
