/*
  The pure half of a structured-output call: the request's thinking setting,
  the usage of a response, and the parse-and-classify step that turns a
  response into the parsed value or says why there is none. No network and no
  server imports, so vitest runs it in node. client.ts makes the call and logs it.
*/
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { ModelId } from "@/config";
import type { TokenUsage } from "./cost";

/**
 * Thinking for one call. "model" sends no thinking setting, so the model runs
 * its default, which is adaptive thinking on Haiku 5.5 and Sonnet 5.5; thinking
 * tokens count against max_tokens. "disabled" turns thinking off: Haiku 5.5
 * accepts it at effort high or below, which covers every effort callStructured
 * takes. Sonnet 5.5 rejects "disabled".
 */
export type ThinkingMode = "model" | "adaptive" | "disabled";

/** The request's thinking parameter for a mode, or undefined to leave it out. */
export function thinkingParam(mode: ThinkingMode): Anthropic.ThinkingConfigParam | undefined {
  switch (mode) {
    case "adaptive":
      return { type: "adaptive" };
    case "disabled":
      return { type: "disabled" };
    case "model":
      return undefined;
  }
}

export function usageOf(
  usage: Pick<Anthropic.Usage, "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens">,
): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/** Why a billed response gave nothing usable. */
export type StructuredFailureKind =
  /** The model declined (stop reason refusal). */
  | "refusal"
  /** The output reached max_tokens and was cut off. */
  | "max_tokens"
  /** The model's context window ran out while it wrote. */
  | "context_window"
  /** No text block in the response. */
  | "no_output"
  /** The text is not JSON. */
  | "invalid_json"
  /** JSON that does not match the zod schema. */
  | "schema_mismatch";

export type StructuredOutcome<T> =
  | { ok: true; parsed: T }
  | { ok: false; kind: StructuredFailureKind; message: string };

/** The parts of a Message the classifier reads, so a test can pass a fake with just these. */
export type StructuredResponse = Pick<Anthropic.Message, "content" | "stop_reason" | "stop_details">;

/**
 * Reads the response's text block and parses it with the schema. The stop
 * reason is checked first: a refusal, a max_tokens cut-off, or a full context
 * window each get their own kind even when the cut happens to leave valid JSON.
 */
export function classifyStructured<S extends z.ZodType>(
  response: StructuredResponse,
  schema: S,
): StructuredOutcome<z.infer<S>> {
  switch (response.stop_reason) {
    case "refusal": {
      const category = response.stop_details?.category;
      return {
        ok: false,
        kind: "refusal",
        message: `The model declined this request${category ? ` (${category})` : ""}.`,
      };
    }
    case "max_tokens":
      return {
        ok: false,
        kind: "max_tokens",
        message: "The output reached the max_tokens limit and was cut off before the JSON was complete.",
      };
    case "model_context_window_exceeded":
      return {
        ok: false,
        kind: "context_window",
        message: "The model ran out of context window before the output was complete.",
      };
  }

  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  const text = block?.text.trim() ?? "";
  if (!text) {
    return {
      ok: false,
      kind: "no_output",
      message: `The model returned no text (stop reason ${response.stop_reason ?? "none"}).`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      kind: "invalid_json",
      message: `The output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, kind: "schema_mismatch", message: `The output does not match the schema: ${issues}` };
  }
  return { ok: true, parsed: result.data };
}

export interface StructuredCallCost {
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
  model: ModelId;
  stopReason: string | null;
}

/**
 * Thrown by callStructured when the API answered but the answer is not
 * usable. The call was billed: usage and costUsd say what it cost, and the
 * same numbers are already in llm_calls.
 */
export class StructuredCallError extends Error {
  readonly kind: StructuredFailureKind;
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly model: ModelId;
  readonly stopReason: string | null;

  constructor(kind: StructuredFailureKind, message: string, cost: StructuredCallCost) {
    super(message);
    this.name = "StructuredCallError";
    this.kind = kind;
    this.usage = cost.usage;
    this.costUsd = cost.costUsd;
    this.durationMs = cost.durationMs;
    this.model = cost.model;
    this.stopReason = cost.stopReason;
  }
}
