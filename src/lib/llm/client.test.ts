import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callStructured, StructuredCallError } from "./client";

/*
  callStructured against a stubbed fetch: every path writes one llm_calls row,
  including the billed ones whose output cannot be used.
*/

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        h.rows.push(row);
        return { error: null };
      },
    }),
  }),
}));

// The client is built on the first call, so it picks up the stubbed fetch and key.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

const Schema = z.object({ findings: z.array(z.object({ field_id: z.string() })) });
const ctx = { runId: "run-1", purpose: "extract_page" };

function message(text: string, stopReason: string, usage = { input_tokens: 6_000, output_tokens: 600 }) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    diagnostics: null,
    usage: { ...usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sentBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  h.rows.length = 0;
  fetchMock.mockReset();
});

describe("callStructured", () => {
  it("parses the output and logs the call", async () => {
    fetchMock.mockResolvedValue(reply(message('{"findings":[{"field_id":"phone"}]}', "end_turn")));
    const result = await callStructured({ model: "claude-haiku-5-5", system: "s", user: "u", schema: Schema, ctx });
    expect(result.parsed).toEqual({ findings: [{ field_id: "phone" }] });
    expect(result.usage).toEqual({ inputTokens: 6_000, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(h.rows).toEqual([expect.objectContaining({ ok: true, error: null, input_tokens: 6_000, output_tokens: 600, run_id: "run-1" })]);
    // No thinking setting unless the caller asks for one.
    expect(sentBody()).not.toHaveProperty("thinking");
  });

  it("sends disabled thinking, the effort, max_tokens, and the JSON schema when asked", async () => {
    fetchMock.mockResolvedValue(reply(message('{"findings":[]}', "end_turn")));
    await callStructured({
      model: "claude-haiku-5-5",
      system: "s",
      user: "u",
      schema: Schema,
      maxTokens: 16_000,
      effort: "low",
      thinking: "disabled",
      cacheSystem: true,
      ctx,
    });
    const body = sentBody();
    expect(body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 16_000,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema" } },
      system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }],
    });
    expect((body.output_config as { format: { schema: unknown } }).format.schema).toMatchObject({ type: "object" });
  });

  it("logs a max_tokens cut-off with its usage and cost before it throws", async () => {
    fetchMock.mockResolvedValue(
      reply(message('{"findings":[{"field_id":"pho', "max_tokens", { input_tokens: 6_000, output_tokens: 16_000 })),
    );
    const error = await callStructured({ model: "claude-haiku-5-5", system: "s", user: "u", schema: Schema, ctx }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StructuredCallError);
    expect(error).toMatchObject({ kind: "max_tokens", stopReason: "max_tokens", usage: { outputTokens: 16_000 } });
    // 6,000 in at $0.10/M plus 16,000 out at $0.50/M.
    expect(h.rows).toEqual([
      expect.objectContaining({ ok: false, input_tokens: 6_000, output_tokens: 16_000, cost_usd: 0.0086 }),
    ]);
    expect(String(h.rows[0].error)).toMatch(/^max_tokens: /);
  });

  it("logs output that is not the schema's shape", async () => {
    fetchMock.mockResolvedValue(reply(message('{"findings":"none"}', "end_turn")));
    await expect(
      callStructured({ model: "claude-haiku-5-5", system: "s", user: "u", schema: Schema, ctx }),
    ).rejects.toMatchObject({ kind: "schema_mismatch" });
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, input_tokens: 6_000, output_tokens: 600 })]);
  });

  it("logs a refusal", async () => {
    fetchMock.mockResolvedValue(reply(message("", "refusal")));
    await expect(
      callStructured({ model: "claude-haiku-5-5", system: "s", user: "u", schema: Schema, ctx }),
    ).rejects.toMatchObject({ kind: "refusal" });
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: "refusal: The model declined this request." })]);
  });

  it("logs an API error with no usage and rethrows the SDK's error", async () => {
    fetchMock.mockResolvedValue(reply({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529));
    const error = await callStructured({ model: "claude-haiku-5-5", system: "s", user: "u", schema: Schema, ctx }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Anthropic.APIError);
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0 })]);
    expect(String(h.rows[0].error)).toMatch(/^529: /);
  });
});
