/*
  Quote verification. The extractor may not set a field without a quote that is
  a verbatim substring of the page text after whitespace normalization.
*/
import type { Finding } from "@/lib/facts/types";
import { straightenText } from "./normalize";

/** How many leading characters of a long quote must match when its tail was trimmed. */
export const QUOTE_PREFIX_CHARS = 80;

/**
 * Lowercase, straight quotes, plain hyphens for en and em dashes, plain spaces
 * for non-breaking spaces, all whitespace collapsed to single spaces, trimmed.
 */
export function normalizeForMatch(s: string): string {
  return straightenText(s).toLowerCase();
}

function quoteVariants(normalizedQuote: string): string[] {
  const stripped = normalizedQuote
    .replace(/^["'(\[]+/, "")
    .replace(/["')\].,;:!?]+$/, "")
    .trim();
  return stripped && stripped !== normalizedQuote ? [normalizedQuote, stripped] : [normalizedQuote];
}

/** True when the normalized quote is found in the already-normalized page text. */
export function quoteMatches(quote: string, normalizedPage: string): boolean {
  const q = normalizeForMatch(quote);
  if (!q || !normalizedPage) return false;
  for (const variant of quoteVariants(q)) {
    if (normalizedPage.includes(variant)) return true;
    // Models sometimes trim the tail of a long quote. Accept the first 80
    // characters when they match, and only then.
    if (variant.length > QUOTE_PREFIX_CHARS && normalizedPage.includes(variant.slice(0, QUOTE_PREFIX_CHARS))) {
      return true;
    }
  }
  return false;
}

export function verifyQuote(quote: string, pageText: string): boolean {
  return quoteMatches(quote, normalizeForMatch(pageText));
}

/**
 * Splits findings into the ones whose quote is on the page and the ones that
 * are not. Findings that did not come from the model (JSON-LD, links, images,
 * meta) carry the raw value as their quote and are always kept.
 */
export function verifyFindings(findings: Finding[], pageText: string): { kept: Finding[]; dropped: Finding[] } {
  const page = normalizeForMatch(pageText);
  const kept: Finding[] = [];
  const dropped: Finding[] = [];
  for (const finding of findings) {
    if (finding.source !== "page") {
      kept.push(finding);
      continue;
    }
    if (quoteMatches(finding.quote, page)) kept.push(finding);
    else dropped.push(finding);
  }
  return { kept, dropped };
}
