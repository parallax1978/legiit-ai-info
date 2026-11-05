import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config, type ModelId } from "@/config";
import { createServiceClient } from "@/lib/supabase/service";
import { estimateCostUsd, type TokenUsage } from "./cost";

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
  /** Mark the system prompt for prompt caching. */
  cacheSystem?: boolean;
  ctx: CallContext;
}

/**
 * One structured-output call, with the model, tokens, cost, and duration
 * written to llm_calls whether it succeeds or fails. Throws on failure after
 * logging.
 */
export async function callStructured<S extends z.ZodType>(
  opts: StructuredCallOptions<S>,
): Promise<StructuredCallResult<z.infer<S>>> {
  const anthropic = getAnthropic();
  const started = Date.now();

  try {
    const response = await anthropic.messages.parse({
      model: opts.model,
      max_tokens: opts.maxTokens ?? config.extract.maxOutputTokens,
      system: opts.cacheSystem
        ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]
        : opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: {
        format: zodOutputFormat(opts.schema),
        ...(opts.effort ? { effort: opts.effort } : {}),
      },
    });

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    const costUsd = estimateCostUsd(opts.model, usage);
    const durationMs = Date.now() - started;

    if (response.stop_reason === "refusal") {
      await logCall(opts, usage, costUsd, durationMs, false, "refusal");
      throw new Error("The model declined this request.");
    }
    if (response.parsed_output == null) {
      await logCall(opts, usage, costUsd, durationMs, false, `unparsed (${response.stop_reason})`);
      throw new Error(`The model returned no parsable output (stop reason ${response.stop_reason}).`);
    }

    await logCall(opts, usage, costUsd, durationMs, true, null);
    return {
      parsed: response.parsed_output as z.infer<S>,
      usage,
      costUsd,
      durationMs,
      model: opts.model,
      stopReason: response.stop_reason,
    };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      await logCall(
        opts,
        { inputTokens: 0, outputTokens: 0 },
        0,
        Date.now() - started,
        false,
        `${error.status ?? "network"}: ${error.message}`,
      );
    }
    throw error;
  }
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
    await db.from("llm_calls").insert({
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
  } catch (e) {
    console.error("llm_calls insert failed", e);
  }
}
