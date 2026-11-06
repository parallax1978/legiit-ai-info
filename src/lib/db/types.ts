/*
  Hand-written row types for the tables in supabase/migrations. Keep in step
  with the SQL. When the Supabase CLI is wired up, `supabase gen types` can
  replace this file; the names are chosen to match what it would produce.
*/
import type { FactSheetData, FactSheetStats, Finding } from "@/lib/facts/types";
import type { TemplateSpec } from "@/templates/types";

export type PlanT = "free" | "paid" | "sponsored";
export type ProjectModeT = "crawl" | "manual";
export type ProjectStatusT = "new" | "crawling" | "review" | "generating" | "ready" | "failed";
export type PlatformT =
  | "wordpress"
  | "shopify"
  | "wix"
  | "squarespace"
  | "webflow"
  | "other"
  | "unknown";
export type RunStatusT = "queued" | "running" | "done" | "failed" | "cancelled";
export type RunPhaseT = "discover" | "fetch" | "extract" | "merge" | "done" | "failed";
export type PageStatusT = "queued" | "fetched" | "skipped" | "failed" | "extracted";
export type GenerationStatusT = "queued" | "writing" | "linting" | "done" | "failed";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type PlatformEvidence = {
  signal: string;
  value: string;
  url?: string;
};

export type RunLogEntry = {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
};

/** The step state stored in crawl_runs.cursor. */
export type RunCursor = {
  /** URLs still to fetch, in rank order, each with the reason it was chosen. */
  queue?: { url: string; rank: number; reason: string }[];
  /** URLs seen during discovery (sitemap or links), to stop duplicates. */
  seen?: string[];
  /** crawl_pages ids still to extract. */
  extractQueue?: string[];
  /** The next unused rank number. */
  nextRank?: number;
  /** Set when discovery had to fall back to following links from the home page. */
  usedSitemap?: boolean;
  homeUrl?: string;
  /** Step errors in a row; the run fails at MAX_STEP_ERRORS (src/lib/runs/logic.ts). A slice that succeeds resets it. */
  errorCount?: number;
  /** Extraction attempts per crawl_pages id; a page is marked failed after config.llm.extractAttempts. */
  extractAttempts?: Record<string, number>;
  /**
   * Steps started on the current phase slice without finishing it. Written when
   * a step takes the lock and reset when a slice completes, so steps killed at
   * the function ceiling are counted (config.crawl.maxStepAttempts).
   */
  attempts?: number;
};

export type PageLinks = {
  tel?: string[];
  mailto?: string[];
  social?: { platform: string; url: string; text?: string }[];
  maps?: string[];
  reviews?: { site: string; url: string }[];
  /** Same-host links found on the page, used when there is no sitemap. */
  internal?: { url: string; text: string }[];
};

export type PageImage = {
  src: string;
  alt: string;
  kind: "logo" | "award" | "badge" | "other";
  /** Why it was flagged: alt text, file name, or class. */
  reason: string;
};

export type PageHeading = {
  level: number;
  text: string;
};

export type JsonLdBlock = {
  /** Parsed JSON-LD, or null when it did not parse. */
  data: Json | null;
  raw: string;
  error?: string;
  types: string[];
};

export type ProfileRow = {
  id: string;
  email: string;
  plan: PlanT;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessCodeRow = {
  id: string;
  code: string;
  label: string | null;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type AccessCodeRedemptionRow = {
  id: string;
  code_id: string;
  user_id: string;
  created_at: string;
};

export type TemplateRow = {
  id: string;
  version: number;
  name: string;
  spec: TemplateSpec;
  created_at: string;
  updated_at: string;
};

export type ProjectRow = {
  id: string;
  user_id: string;
  site_url: string;
  site_host: string | null;
  business_name: string | null;
  platform: PlatformT;
  platform_evidence: PlatformEvidence[];
  template_id: string;
  mode: ProjectModeT;
  status: ProjectStatusT;
  latest_crawl_run_id: string | null;
  latest_fact_sheet_id: string | null;
  latest_generation_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CrawlRunRow = {
  id: string;
  project_id: string;
  user_id: string;
  status: RunStatusT;
  phase: RunPhaseT;
  cursor: RunCursor;
  pages_planned: number;
  pages_fetched: number;
  pages_failed: number;
  pages_extracted: number;
  text_bytes: number;
  platform: PlatformT;
  platform_evidence: PlatformEvidence[];
  robots: Json | null;
  sitemaps: string[];
  log: RunLogEntry[];
  error: string | null;
  locked_at: string | null;
  lock_token: string | null;
  started_at: string | null;
  finished_at: string | null;
  cost_usd: number;
  fact_sheet_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CrawlPageRow = {
  id: string;
  run_id: string;
  project_id: string;
  user_id: string;
  url: string;
  normalized_url: string;
  rank: number;
  reason: string | null;
  status: PageStatusT;
  http_status: number | null;
  fetched_at: string | null;
  title: string | null;
  meta_description: string | null;
  canonical: string | null;
  lang: string | null;
  text: string | null;
  text_chars: number;
  headings: PageHeading[];
  html_path: string | null;
  html_bytes: number | null;
  jsonld: JsonLdBlock[];
  links: PageLinks;
  images: PageImage[];
  findings: Finding[] | null;
  findings_dropped: number;
  extract_tokens_in: number | null;
  extract_tokens_out: number | null;
  extract_cost_usd: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type FactSheetRow = {
  id: string;
  project_id: string;
  user_id: string;
  version: number;
  source: "crawl" | "manual";
  crawl_run_id: string | null;
  template_id: string;
  data: FactSheetData;
  existing_schema: JsonLdBlock[];
  stats: FactSheetStats | Record<string, never>;
  created_at: string;
  updated_at: string;
};

export type GenerationRow = {
  id: string;
  project_id: string;
  user_id: string;
  version: number;
  fact_sheet_id: string | null;
  fact_sheet_version: number | null;
  status: GenerationStatusT;
  page_html: string | null;
  wordpress_html: string | null;
  schema: Json | null;
  instructions_md: string | null;
  still_to_fill: Json;
  lint_report: Json;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  error: string | null;
  draft: Json | null;
  cursor: Json;
  log: RunLogEntry[];
  locked_at: string | null;
  lock_token: string | null;
  attempts: number;
  title: string | null;
  meta_description: string | null;
  platform: PlatformT;
  page_url: string | null;
  created_at: string;
  updated_at: string;
};

export type LlmCallRow = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  run_id: string | null;
  generation_id: string | null;
  purpose: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  duration_ms: number | null;
  ok: boolean;
  error: string | null;
  created_at: string;
};

export type ShareLinkRow = {
  id: string;
  token: string;
  project_id: string;
  generation_id: string | null;
  user_id: string;
  expires_at: string | null;
  created_at: string;
};

export type UsageEventRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  kind: "project_created" | "crawl_started" | "generation_started";
  created_at: string;
};

type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow, "id" | "email">;
      access_codes: Table<AccessCodeRow, "code">;
      access_code_redemptions: Table<AccessCodeRedemptionRow, "code_id" | "user_id">;
      templates: Table<TemplateRow, "id" | "name" | "spec">;
      projects: Table<ProjectRow, "user_id" | "site_url">;
      crawl_runs: Table<CrawlRunRow, "project_id" | "user_id">;
      crawl_pages: Table<CrawlPageRow, "run_id" | "project_id" | "user_id" | "url" | "normalized_url">;
      fact_sheets: Table<FactSheetRow, "project_id" | "user_id" | "version" | "source" | "template_id">;
      generations: Table<GenerationRow, "project_id" | "user_id" | "version">;
      llm_calls: Table<LlmCallRow, "purpose" | "model">;
      share_links: Table<ShareLinkRow, "token" | "project_id" | "user_id">;
      usage_events: Table<UsageEventRow, "user_id" | "kind">;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      plan_t: PlanT;
      project_mode_t: ProjectModeT;
      project_status_t: ProjectStatusT;
      platform_t: PlatformT;
      run_status_t: RunStatusT;
      run_phase_t: RunPhaseT;
      page_status_t: PageStatusT;
      generation_status_t: GenerationStatusT;
    };
    CompositeTypes: Record<string, never>;
  };
}
