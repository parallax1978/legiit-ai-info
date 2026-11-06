/*
  The JSON-LD graph: the organization and the about page with its FAQ, built
  from the fact sheet and the draft by code. See docs/build-spec.md and
  examples/legiit-schema.html; the schema+render builder replaces the stub.
*/
import type { FactSheetData } from "@/lib/facts/types";
import type { TemplateSpec } from "@/templates/types";
import type { PageDraft } from "./types";

export interface JsonLdInput {
  spec: TemplateSpec;
  data: FactSheetData;
  draft: PageDraft;
  siteUrl: string;
  pageUrl: string;
}

export function buildJsonLd(input: JsonLdInput): Record<string, unknown> {
  void input;
  return { "@context": "https://schema.org", "@graph": [] };
}
