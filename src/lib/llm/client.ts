import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config, type ModelId } from "@/config";
import { createServiceClient } from "@/lib/supabase/service";
import { estimateCostUsd, type TokenUsage } from "./cost";
import { classifyStructured, StructuredCallError, thinkingParam, usageOf, type ThinkingMode } from "./structured";

export { StructuredCallError, type StructuredFailureKind, type ThinkingMode } from "./structured";

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Milliseconds. Every call must finish inside one Vercel function invocation;
    // see config.llm for why the SDK does not retry.
    timeout: config.llm.timeoutMs,
    maxRetries: config.llm.maxRetries,
  });
  return client;
}

/**
 * Thinking for a call that does not set it: the model's own default. Callers
 * pass "disabled" where a reasoning pass buys nothing (page extraction). This
 * is the flag config.ts can take over.
 */
export const DEFAULT_THINKING: ThinkingMode = "model";

export interface CallContext {
  userId?: string | null;
  projectId?: string | null;
  runId?: string | null;
  generationId?: string | null;
  /** Short label stored on llm_calls, e.g. "extract_page", "write_page". */
  purpose: string;
}

export interface StructuredCallResult<T> {
  parsed: T;
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
  model: ModelId;
  stopReason: string | null;
}

export interface StructuredCallOptions<S extends z.ZodType> {
  model: ModelId;
  system: string;
  user: string;
  schema: S;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** DEFAULT_THINKING when left out. */
  thinking?: ThinkingMode;
  /** Mark the system prompt for prompt caching. */
  cacheSystem?: boolean;
  /** Per-request timeout, milliseconds; config.llm.timeoutMs when left out. */
  timeoutMs?: number;
  ctx: CallContext;
}

function errorText(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `${error.status ?? "network"}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * One structured-output call, with the model, tokens, cost, and duration
 * written to llm_calls on every path: success, refusal, a max_tokens cut-off,
 * output that is not JSON or does not match the schema, and API errors. The
 * response is parsed here rather than by messages.parse, so a billed call
 * whose output cannot be used is still logged with its usage. Throws after
 * logging: the SDK's error when the request failed, a StructuredCallError
 * (with usage and cost) when the response could not be used.
 */
export async function callStructured<S extends z.ZodType>(
  opts: StructuredCallOptions<S>,
): Promise<StructuredCallResult<z.infer<S>>> {
  const anthropic = getAnthropic();
  const format = zodOutputFormat(opts.schema);
  const thinking = thinkingParam(opts.thinking ?? DEFAULT_THINKING);
  const started = Date.now();

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? config.extract.maxOutputTokens,
      system: opts.cacheSystem
        ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]
        : opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: {
        format: { type: "json_schema", schema: format.schema },
        ...(opts.effort ? { effort: opts.effort } : {}),
      },
      ...(thinking ? { thinking } : {}),
    }, opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined);
  } catch (error) {
    // No response came back (an HTTP error, a network error, a timeout), so there is no usage to record.
    await logCall(opts, { inputTokens: 0, outputTokens: 0 }, 0, Date.now() - started, false, errorText(error));
    throw error;
  }

  const usage = usageOf(response.usage);
  const costUsd = estimateCostUsd(opts.model, usage);
  const durationMs = Date.now() - started;
  const outcome = classifyStructured(response, opts.schema);

  if (!outcome.ok) {
    await logCall(opts, usage, costUsd, durationMs, false, `${outcome.kind}: ${outcome.message}`);
    throw new StructuredCallError(outcome.kind, outcome.message, {
      usage,
      costUsd,
      durationMs,
      model: opts.model,
      stopReason: response.stop_reason,
    });
  }

  await logCall(opts, usage, costUsd, durationMs, true, null);
  return {
    parsed: outcome.parsed,
    usage,
    costUsd,
    durationMs,
    model: opts.model,
    stopReason: response.stop_reason,
  };
}

async function logCall<S extends z.ZodType>(
  opts: StructuredCallOptions<S>,
  usage: TokenUsage,
  costUsd: number,
  durationMs: number,
  ok: boolean,
  error: string | null,
) {
  try {
    const db = createServiceClient();
    const { error: insertError } = await db.from("llm_calls").insert({
      user_id: opts.ctx.userId ?? null,
      project_id: opts.ctx.projectId ?? null,
      run_id: opts.ctx.runId ?? null,
      generation_id: opts.ctx.generationId ?? null,
      purpose: opts.ctx.purpose,
      model: opts.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens ?? 0,
      cache_write_tokens: usage.cacheWriteTokens ?? 0,
      cost_usd: costUsd,
      duration_ms: durationMs,
      ok,
      error,
    });
    if (insertError) console.error("llm_calls insert failed", insertError.message);
  } catch (e) {
    console.error("llm_calls insert failed", e);
  }
}
