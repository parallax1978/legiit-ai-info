import "server-only";

/*
  The three model calls of a generation: the main sections, the FAQ and the
  closing, and a rewrite that answers a lint report. Every call goes through
  callStructured with the generation's context so it lands in llm_calls. The
  system prompt is the same bytes for all three calls of a generation, so the
  prompt cache pays for itself on the second one. Follows src/lib/extract/page.ts.
*/
import type { z } from "zod";
import { config } from "@/config";
import type { FactSheetData } from "@/lib/facts/types";
import { callStructured, type CallContext, type StructuredCallResult } from "@/lib/llm/client";
import type { TemplateSpec } from "@/templates/types";
import { buildRewritePrompt, buildWriterSystemPrompt, buildWriterUserPrompt } from "./prompt";
import { DraftFaqSchema, DraftFullSchema, DraftMainSchema, draftFromFull, draftFromMain, draftWithFaq } from "./schema";
import type { LintReport, PageDraft, WriterResult } from "./types";

export interface WriteInput {
  spec: TemplateSpec;
  data: FactSheetData;
  siteUrl: string;
  companyName: string;
  ctx: CallContext;
}

/** The purpose stored on llm_calls for each call. */
export type WritePurpose = "write_page" | "write_faq" | "rewrite_page";

// The system prompt is a pure function of the spec, and the same bytes every
// call is what makes the prompt cache hit.
const systemPrompts = new WeakMap<TemplateSpec, string>();

function systemPromptFor(spec: TemplateSpec): string {
  let prompt = systemPrompts.get(spec);
  if (!prompt) {
    prompt = buildWriterSystemPrompt(spec);
    systemPrompts.set(spec, prompt);
  }
  return prompt;
}

function callWriter<S extends z.ZodType>(
  input: WriteInput,
  user: string,
  schema: S,
  purpose: WritePurpose,
): Promise<StructuredCallResult<z.infer<S>>> {
  return callStructured({
    model: config.models.write,
    system: systemPromptFor(input.spec),
    user,
    schema,
    maxTokens: config.generate.maxOutputTokens,
    timeoutMs: config.generate.timeoutMs,
    effort: config.generate.effort,
    // Sonnet 5.5 rejects disabled thinking, so the call runs the model's default.
    cacheSystem: true,
    ctx: { ...input.ctx, purpose },
  });
}

function result(draft: PageDraft, call: StructuredCallResult<unknown>): WriterResult {
  return { draft, usage: call.usage, costUsd: call.costUsd, model: call.model };
}

/** Writes everything but the FAQ and the closing; the returned draft has those empty. */
export async function writeMain(input: WriteInput): Promise<WriterResult> {
  const user = buildWriterUserPrompt({
    spec: input.spec,
    data: input.data,
    siteUrl: input.siteUrl,
    companyName: input.companyName,
    part: "main",
  });
  const call = await callWriter(input, user, DraftMainSchema, "write_page");
  return result(draftFromMain(call.parsed), call);
}

/** Writes the FAQ and the closing onto a draft that has the rest. */
export async function writeFaq(input: WriteInput & { draft: PageDraft }): Promise<WriterResult> {
  const user = buildWriterUserPrompt({
    spec: input.spec,
    data: input.data,
    siteUrl: input.siteUrl,
    companyName: input.companyName,
    part: "faq",
    draft: input.draft,
  });
  const call = await callWriter(input, user, DraftFaqSchema, "write_faq");
  return result(draftWithFaq(input.draft, call.parsed), call);
}

/** Rewrites only what the lint report names, keeping everything else word for word. */
export async function rewriteDraft(input: WriteInput & { draft: PageDraft; report: LintReport }): Promise<WriterResult> {
  const user = buildRewritePrompt({ spec: input.spec, data: input.data, draft: input.draft, report: input.report });
  const call = await callWriter(input, user, DraftFullSchema, "rewrite_page");
  return result(draftFromFull(call.parsed), call);
}
