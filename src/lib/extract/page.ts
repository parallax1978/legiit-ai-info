import "server-only";

/*
  Extraction for one crawled page: one Haiku call with structured output, the
  quote check on every finding, then the deterministic findings from JSON-LD,
  links, images, and meta appended.
*/
import { config, type ModelId } from "@/config";
import type { JsonLdBlock, PageImage, PageLinks } from "@/lib/db/types";
import type { Finding } from "@/lib/facts/types";
import { callStructured, type CallContext, type ThinkingMode } from "@/lib/llm/client";
import type { TokenUsage } from "@/lib/llm/cost";
import type { TemplateSpec } from "@/templates/types";
import {
  findingsFromImages,
  findingsFromJsonLd,
  findingsFromLinks,
  findingsFromMeta,
  type CleanedMeta,
} from "./deterministic";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { ExtractionOutputSchema, toFindings } from "./schema";
import { verifyFindings } from "./verify";

/** Pages with less text than this skip the model and keep only the deterministic findings. */
export const MIN_TEXT_CHARS = 40;

/** Output tokens for one page's findings; see config.extract.maxOutputTokens. */
export const EXTRACT_MAX_TOKENS = config.extract.maxOutputTokens;

/** Extraction runs without a thinking pass; see config.extract.thinking. */
export const EXTRACT_THINKING: ThinkingMode = config.extract.thinking;

export interface ExtractPageInput {
  url: string;
  title: string | null;
  text: string;
  jsonld: JsonLdBlock[];
  links: PageLinks;
  images: PageImage[];
  cleanedMeta: CleanedMeta;
  isHome: boolean;
  spec: TemplateSpec;
  ctx: CallContext;
}

export interface ExtractPageResult {
  findings: Finding[];
  /** Model findings whose quote was not found on the page. */
  dropped: number;
  usage: TokenUsage;
  costUsd: number;
  /** null when the page was too short for a model call. */
  model: ModelId | null;
  summary: string;
  businessNameGuess: string;
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

// The system prompt is a pure function of the spec, and the same bytes every
// call is what makes the prompt cache hit.
const systemPrompts = new WeakMap<TemplateSpec, string>();

function systemPromptFor(spec: TemplateSpec): string {
  let prompt = systemPrompts.get(spec);
  if (!prompt) {
    prompt = buildSystemPrompt(spec);
    systemPrompts.set(spec, prompt);
  }
  return prompt;
}

function jsonLdTypes(blocks: JsonLdBlock[]): string[] {
  const out = new Set<string>();
  for (const block of blocks ?? []) {
    for (const t of block?.types ?? []) if (t) out.add(t);
  }
  return [...out];
}

/** The findings that need no model call. */
export function deterministicFindings(
  input: Pick<ExtractPageInput, "url" | "jsonld" | "links" | "images" | "cleanedMeta" | "isHome">,
): Finding[] {
  return [
    ...findingsFromJsonLd(input.jsonld ?? [], input.url),
    ...findingsFromLinks(input.links ?? {}, input.url),
    ...findingsFromImages(input.images ?? [], input.url),
    ...findingsFromMeta(input.cleanedMeta ?? {}, input.url, input.isHome),
  ];
}

export async function extractPage(input: ExtractPageInput): Promise<ExtractPageResult> {
  const deterministic = deterministicFindings(input);
  const text = (input.text ?? "").slice(0, config.crawl.maxPageTextChars);

  if (text.trim().length < MIN_TEXT_CHARS) {
    return {
      findings: deterministic,
      dropped: 0,
      usage: { ...ZERO_USAGE },
      costUsd: 0,
      model: null,
      summary: "",
      businessNameGuess: "",
    };
  }

  const result = await callStructured({
    model: config.models.extract,
    system: systemPromptFor(input.spec),
    user: buildUserPrompt({
      url: input.url,
      title: input.title,
      text,
      existingJsonLdTypes: jsonLdTypes(input.jsonld),
    }),
    schema: ExtractionOutputSchema,
    maxTokens: EXTRACT_MAX_TOKENS,
    // Disabled thinking is accepted at effort high or below.
    effort: "low",
    thinking: EXTRACT_THINKING,
    cacheSystem: true,
    ctx: { ...input.ctx, purpose: input.ctx.purpose || "extract_page" },
  });

  const modelFindings = toFindings(result.parsed, { url: input.url, spec: input.spec });
  const { kept, dropped } = verifyFindings(modelFindings, text, input.spec);

  return {
    findings: [...kept, ...deterministic],
    dropped: dropped.length,
    usage: result.usage,
    costUsd: result.costUsd,
    model: result.model,
    summary: (result.parsed.page_summary ?? "").trim(),
    businessNameGuess: (result.parsed.business_name_guess ?? "").trim(),
  };
}
