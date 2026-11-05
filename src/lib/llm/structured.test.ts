import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { classifyStructured, StructuredCallError, thinkingParam, usageOf, type StructuredResponse } from "./structured";

const Schema = z.object({
  findings: z.array(z.object({ field_id: z.string(), value: z.string() })),
  page_summary: z.string(),
});

function text(t: string): Anthropic.TextBlock {
  return { type: "text", text: t, citations: null };
}

function response(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.StopReason | null = "end_turn",
  stopDetails: Anthropic.Message["stop_details"] = null,
): StructuredResponse {
  return { content, stop_reason: stopReason, stop_details: stopDetails };
}

const GOOD = '{"findings":[{"field_id":"phone","value":"604-533-9163"}],"page_summary":"The contact page."}';

describe("classifyStructured", () => {
  it("parses a complete response", () => {
    expect(classifyStructured(response([text(GOOD)]), Schema)).toEqual({
      ok: true,
      parsed: { findings: [{ field_id: "phone", value: "604-533-9163" }], page_summary: "The contact page." },
    });
  });

  it("reads the text block after a thinking block", () => {
    const thinking: Anthropic.ThinkingBlock = { type: "thinking", thinking: "", signature: "sig" };
    expect(classifyStructured(response([thinking, text(GOOD)]), Schema).ok).toBe(true);
  });

  it("names a max_tokens cut-off, even when the text happens to parse", () => {
    const cut = classifyStructured(response([text('{"findings":[{"field_id":"phone","val')], "max_tokens"), Schema);
    expect(cut).toMatchObject({ ok: false, kind: "max_tokens" });
    expect(classifyStructured(response([text(GOOD)], "max_tokens"), Schema)).toMatchObject({ ok: false, kind: "max_tokens" });
  });

  it("names a refusal with its category", () => {
    const refused = classifyStructured(
      response([text("")], "refusal", { type: "refusal", category: "cyber", explanation: null }),
      Schema,
    );
    expect(refused).toEqual({ ok: false, kind: "refusal", message: "The model declined this request (cyber)." });
    expect(classifyStructured(response([], "refusal"), Schema)).toEqual({
      ok: false,
      kind: "refusal",
      message: "The model declined this request.",
    });
  });

  it("names a full context window", () => {
    expect(classifyStructured(response([text("{")], "model_context_window_exceeded"), Schema)).toMatchObject({
      ok: false,
      kind: "context_window",
    });
  });

  it("names output that is missing, not JSON, or not the schema's shape", () => {
    expect(classifyStructured(response([]), Schema)).toMatchObject({ ok: false, kind: "no_output" });
    expect(classifyStructured(response([text("   ")]), Schema)).toMatchObject({ ok: false, kind: "no_output" });
    expect(classifyStructured(response([text("Here are the findings: none")]), Schema)).toMatchObject({
      ok: false,
      kind: "invalid_json",
    });
    const mismatch = classifyStructured(response([text('{"findings":[{"field_id":7}]}')]), Schema);
    expect(mismatch).toMatchObject({ ok: false, kind: "schema_mismatch" });
    if (!mismatch.ok) expect(mismatch.message).toContain("findings.0.field_id");
  });
});

describe("usageOf", () => {
  it("maps the API's usage, with missing cache counts as zero", () => {
    expect(
      usageOf({ input_tokens: 6_000, output_tokens: 700, cache_read_input_tokens: 3_000, cache_creation_input_tokens: null }),
    ).toEqual({ inputTokens: 6_000, outputTokens: 700, cacheReadTokens: 3_000, cacheWriteTokens: 0 });
  });
});

describe("thinkingParam", () => {
  it("sends nothing for the model's default and the SDK shapes otherwise", () => {
    expect(thinkingParam("model")).toBeUndefined();
    expect(thinkingParam("disabled")).toEqual({ type: "disabled" });
    expect(thinkingParam("adaptive")).toEqual({ type: "adaptive" });
  });
});

describe("StructuredCallError", () => {
  it("carries what the failed call cost", () => {
    const error = new StructuredCallError("max_tokens", "cut off", {
      usage: { inputTokens: 6_000, outputTokens: 16_000 },
      costUsd: 0.0086,
      durationMs: 30_000,
      model: "claude-haiku-5-5",
      stopReason: "max_tokens",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "StructuredCallError", kind: "max_tokens", costUsd: 0.0086, message: "cut off" });
  });
});
