/*
  Platform detection from the raw HTML: the generator meta tag plus the asset
  paths and markup each builder leaves behind. Every matched signal is kept
  as evidence; the signal text is prefixed with the platform it points at so
  pages can be merged later.
*/
import type { PlatformEvidence, PlatformT } from "@/lib/db/types";

export type PlatformDetection = { platform: PlatformT; evidence: PlatformEvidence[] };

type NamedPlatform = Exclude<PlatformT, "other" | "unknown">;

const PLATFORMS: NamedPlatform[] = ["wordpress", "shopify", "wix", "squarespace", "webflow"];

type Signal = { platform: NamedPlatform; signal: string; re: RegExp };

const SIGNALS: Signal[] = [
  { platform: "wordpress", signal: "wp-content asset path", re: /\/wp-content\/[^"'\s)]*/i },
  { platform: "wordpress", signal: "wp-includes asset path", re: /\/wp-includes\/[^"'\s)]*/i },
  { platform: "wordpress", signal: "wp-json link", re: /\/wp-json\/?[^"'\s)]*/i },
  { platform: "wordpress", signal: "wp-block markup", re: /\bwp-block-[a-z-]+/i },
  { platform: "shopify", signal: "Shopify CDN asset", re: /cdn\.shopify\.com[^"'\s)]*/i },
  { platform: "shopify", signal: "Shopify CDN path", re: /\/cdn\/shop\/(files|products|t)\/[^"'\s)]*/i },
  { platform: "shopify", signal: "Shopify.theme script", re: /Shopify\.theme\s*=/ },
  { platform: "shopify", signal: "myshopify.com domain", re: /[a-z0-9-]+\.myshopify\.com/i },
  { platform: "shopify", signal: "shopify-section markup", re: /\bshopify-section\b/i },
  { platform: "wix", signal: "parastorage asset", re: /static\.parastorage\.com[^"'\s)]*/i },
  { platform: "wix", signal: "wixstatic asset", re: /static\.wixstatic\.com[^"'\s)]*/i },
  { platform: "wix", signal: "wix client marker", re: /_wixCIDX|wix-warmup-data|wixsite\.com|X-Wix-Meta-Site-Id/i },
  { platform: "squarespace", signal: "Squarespace CDN asset", re: /(static1?\.squarespace\.com|images\.squarespace-cdn\.com|assets\.squarespace\.com)[^"'\s)]*/i },
  { platform: "squarespace", signal: "Squarespace script", re: /<script[^>]+src=["'][^"']*squarespace[^"']*["']/i },
  { platform: "squarespace", signal: "sqs markup", re: /\bsqs-block\b|Static\.SQUARESPACE_CONTEXT/ },
  { platform: "webflow", signal: "data-wf-site attribute", re: /data-wf-site=["'][^"']*["']/i },
  { platform: "webflow", signal: "data-wf-page attribute", re: /data-wf-page=["'][^"']*["']/i },
  { platform: "webflow", signal: "Webflow asset", re: /(assets(-global)?\.website-files\.com|cdn\.prod\.website-files\.com|uploads-ssl\.webflow\.com|webflow\.com\/js)[^"'\s)]*/i },
];

const GENERATOR_RULES: { platform: NamedPlatform; re: RegExp }[] = [
  { platform: "wordpress", re: /wordpress|elementor|woocommerce|wpbakery|divi|site kit by google|yoast/i },
  { platform: "wix", re: /wix\.com/i },
  { platform: "squarespace", re: /squarespace/i },
  { platform: "webflow", re: /webflow/i },
  { platform: "shopify", re: /shopify/i },
];

const META_TAG_RE = /<meta\b[^>]*>/gi;

function metaAttr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : null;
}

/** The generator meta content, read from the raw HTML without a parse. */
export function readGenerator(html: string): string | null {
  for (const tag of html.match(META_TAG_RE) ?? []) {
    if ((metaAttr(tag, "name") ?? "").toLowerCase() !== "generator") continue;
    const content = metaAttr(tag, "content");
    if (content) return content;
  }
  return null;
}

function clip(value: string): string {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function platformOfSignal(signal: string): PlatformT | null {
  const prefix = signal.split(":")[0]?.trim();
  return PLATFORMS.find((p) => p === prefix) ?? (prefix === "other" ? "other" : null);
}

/**
 * Detects the site builder from one page. Returns every matched signal.
 * "other" when the page is HTML with no known signal, "unknown" when there
 * is no document at all.
 */
export function detectPlatform(
  html: string,
  url: string,
  cleaned?: { generator: string | null },
): PlatformDetection {
  if (!html || !html.trim()) return { platform: "unknown", evidence: [] };

  const evidence: PlatformEvidence[] = [];
  const scores = new Map<NamedPlatform, number>();
  const add = (platform: NamedPlatform | "other", signal: string, value: string, weight: number) => {
    evidence.push({ signal: `${platform}: ${signal}`, value: clip(value), url });
    if (platform !== "other") scores.set(platform, (scores.get(platform) ?? 0) + weight);
  };

  const generator = cleaned?.generator ?? readGenerator(html);
  if (generator) {
    const rule = GENERATOR_RULES.find((r) => r.re.test(generator));
    add(rule?.platform ?? "other", "meta generator", generator, 2);
  }

  for (const s of SIGNALS) {
    const m = s.re.exec(html);
    if (m) add(s.platform, s.signal, m[0], 1);
  }

  let best: NamedPlatform | null = null;
  for (const p of PLATFORMS) {
    const score = scores.get(p) ?? 0;
    if (score > 0 && (best === null || score > (scores.get(best) ?? 0))) best = p;
  }
  return { platform: best ?? "other", evidence };
}

/**
 * One platform for the site from several pages: the named platform with the
 * most evidence wins; a named platform beats "other", "other" beats
 * "unknown". The evidence returned is the winner's, deduped.
 */
export function mergePlatformEvidence(runs: PlatformDetection[]): PlatformDetection {
  const scores = new Map<PlatformT, number>();
  const bump = (p: PlatformT, n: number) => scores.set(p, (scores.get(p) ?? 0) + n);

  for (const run of runs) {
    bump(run.platform, 1);
    for (const e of run.evidence) {
      const p = platformOfSignal(e.signal) ?? run.platform;
      bump(p, 1);
    }
  }

  const tier = (p: PlatformT) => (p === "unknown" ? 0 : p === "other" ? 1 : 2);
  let winner: PlatformT = "unknown";
  for (const [p, score] of scores) {
    const current = scores.get(winner) ?? 0;
    if (tier(p) > tier(winner) || (tier(p) === tier(winner) && score > current)) winner = p;
  }

  const evidence: PlatformEvidence[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    for (const e of run.evidence) {
      const p = platformOfSignal(e.signal) ?? run.platform;
      if (p !== winner && !(winner !== "unknown" && p === "other")) continue;
      const key = `${e.signal}|${e.value}`;
      if (seen.has(key) || evidence.length >= 20) continue;
      seen.add(key);
      evidence.push(e);
    }
  }
  return { platform: winner, evidence };
}
