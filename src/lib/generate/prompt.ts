/*
  The Sonnet prompts for the page writer. See docs/build-spec.md: the writer
  builder replaces these stubs; the signatures are the contract.
*/
import type { FactSheetData } from "@/lib/facts/types";
import type { TemplateSpec } from "@/templates/types";
import type { LintReport, PageDraft } from "./types";

export const WRITING_RULES = `Plain words. Third person, by name. Open on the point. No em dashes. No buzzwords. No exclamation marks. Every number from the fact sheet.`;

export interface WriterPromptInput {
  spec: TemplateSpec;
  data: FactSheetData;
  siteUrl: string;
  companyName: string;
  part: "main" | "faq";
  /** The draft so far, for the faq part. */
  draft?: PageDraft;
}

export function buildWriterSystemPrompt(spec: TemplateSpec): string {
  void spec;
  throw new Error("The page writer is not built yet.");
}

export function buildWriterUserPrompt(input: WriterPromptInput): string {
  void input;
  throw new Error("The page writer is not built yet.");
}

export function buildRewritePrompt(input: { spec: TemplateSpec; data: FactSheetData; draft: PageDraft; report: LintReport }): string {
  void input;
  throw new Error("The page writer is not built yet.");
}
