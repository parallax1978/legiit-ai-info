/*
  One place for every number the product runs on. Model IDs and prices were
  confirmed against platform.claude.com/docs/en/about-claude/models/overview and
  /docs/en/about-claude/pricing on 2026-11-05.
*/

export type ModelId = "claude-haiku-5-5" | "claude-sonnet-5-5";

export interface ModelPricing {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million tokens written to the 5-minute prompt cache. */
  cacheWrite: number;
  /** USD per million tokens read from the prompt cache. */
  cacheRead: number;
  /**
   * Haiku 5.5 charges a higher rate for a request whose prompt (all input
   * tokens, cache reads included) is over this many tokens.
   */
  longContext?: {
    threshold: number;
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  };
}

export type PlanId = "free" | "paid" | "sponsored";

export interface PlanCaps {
  projectsPerMonth: number;
  crawlsPerProject: number;
  generationsPerProject: number;
}

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://legiitaiinfo.com"
).replace(/\/+$/, "");

export const config = {
  site: {
    name: "Legiit Ai Info",
    url: SITE_URL,
    description:
      "An AI-ready About page for your business, built from the facts on your own website, with the schema and install steps.",
    supportEmail: "help@legiit.com",
    legalOwner: "Superstar SEO LLC",
    parentUrl: "https://legiit.com",
  },

  models: {
    /** Per-page summarization and fact extraction. */
    extract: "claude-haiku-5-5" as ModelId,
    /** Writing the About page. */
    write: "claude-sonnet-5-5" as ModelId,
  },

  pricing: {
    "claude-haiku-5-5": {
      input: 0.1,
      output: 0.5,
      cacheWrite: 0.125,
      cacheRead: 0.01,
      longContext: {
        threshold: 100_000,
        input: 0.5,
        output: 2.5,
        cacheWrite: 0.625,
        cacheRead: 0.05,
      },
    },
    "claude-sonnet-5-5": {
      input: 2,
      output: 10,
      cacheWrite: 2.5,
      cacheRead: 0.1,
    },
  } satisfies Record<ModelId, ModelPricing>,

  crawl: {
    userAgent: `LegiitAiInfoBot/0.1 (+${SITE_URL}/bot)`,
    maxPages: 40,
    /** Total extracted text per site. */
    maxTextBytes: 3 * 1024 * 1024,
    /** Extracted text kept per page; keeps every Haiku call far below 100k tokens. */
    maxPageTextChars: 60_000,
    /** Raw HTML kept per page in Storage. */
    maxHtmlBytes: 1_500_000,
    fetchTimeoutMs: 10_000,
    /** Pages fetched in parallel inside one step. */
    parallel: 6,
    /** A step stops starting new work after this long. */
    stepBudgetMs: 20_000,
    /** How long one step may hold the run lock before another caller may take it. */
    lockLeaseMs: 45_000,
    /** Sitemap files read while discovering URLs. */
    maxSitemaps: 12,
    maxSitemapUrls: 2_000,
    maxDiscoveredLinks: 400,
  },

  extract: {
    pagesPerStep: 4,
    parallel: 4,
    maxOutputTokens: 6_000,
  },

  plans: {
    free: { projectsPerMonth: 1, crawlsPerProject: 2, generationsPerProject: 0 },
    paid: { projectsPerMonth: 10, crawlsPerProject: 5, generationsPerProject: 10 },
    sponsored: {
      projectsPerMonth: 10,
      crawlsPerProject: 5,
      generationsPerProject: 10,
    },
  } satisfies Record<PlanId, PlanCaps>,

  billing: {
    /** Placeholder until the cost dashboard gives a real number. */
    planPriceUsd: Number(process.env.PLAN_PRICE_USD ?? 19),
    currency: "usd",
    interval: "month" as const,
  },

  adminEmails: (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  /** Vercel function ceiling for the step routes. */
  stepMaxDurationSeconds: 60,
} as const;

export type AppConfig = typeof config;
