import "server-only";

/*
  The three model calls of a generation: the main sections, the FAQ and the
  closing, and a rewrite that answers a lint report. Every call goes through
  callStructured so it lands in llm_calls. See docs/build-spec.md; the writer
  builder replaces these stubs.
*/
import type { FactSheetData } from "@/lib/facts/types";
import type { CallContext } from "@/lib/llm/client";
import type { TemplateSpec } from "@/templates/types";
import type { LintReport, PageDraft, WriterResult } from "./types";

export interface WriteInput {
  spec: TemplateSpec;
  data: FactSheetData;
  siteUrl: string;
  companyName: string;
  ctx: CallContext;
}

/** Writes everything but the FAQ and the closing; the returned draft has those empty. */
export async function writeMain(input: WriteInput): Promise<WriterResult> {
  void input;
  throw new Error("The page writer is not built yet.");
}

/** Writes the FAQ and the closing onto a draft that has the rest. */
export async function writeFaq(input: WriteInput & { draft: PageDraft }): Promise<WriterResult> {
  void input;
  throw new Error("The page writer is not built yet.");
}

/** Rewrites only what the lint report names, keeping everything else word for word. */
export async function rewriteDraft(input: WriteInput & { draft: PageDraft; report: LintReport }): Promise<WriterResult> {
  void input;
  throw new Error("The page writer is not built yet.");
}
