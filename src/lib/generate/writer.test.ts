import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "@/config";
import type { FactSheetData } from "@/lib/facts/types";
import { callStructured } from "@/lib/llm/client";
import { ABOUT_V1 } from "@/templates/about-v1";
import { buildRewritePrompt, buildWriterSystemPrompt, buildWriterUserPrompt } from "./prompt";
import {
  DraftFaqSchema,
  DraftFullSchema,
  DraftMainSchema,
  draftFromFull,
  draftFromMain,
  draftWithFaq,
  type DraftFaqOutput,
  type DraftMainOutput,
} from "./schema";
import type { LintReport } from "./types";
import { rewriteDraft, writeFaq, writeMain } from "./writer";

/*
  The writer against a mocked callStructured: each call carries the write
  model, the generation's limits, its purpose, and its schema, and the usage
  and cost come back untouched.
*/

vi.mock("server-only", () => ({}));
vi.mock("@/lib/llm/client", () => ({ callStructured: vi.fn() }));

const mocked = vi.mocked(callStructured);

function loadFixture(): FactSheetData {
  const file = path.join(process.cwd(), "examples", "fixtures", "legiit.factsheet.json");
  return JSON.parse(readFileSync(file, "utf8")) as FactSheetData;
}

function mainOutput(): DraftMainOutput {
  return {
    metaTitle: "About Legiit | Curated freelance marketplace",
    metaDescription: "Legiit is a curated freelance marketplace for business owners and agencies.",
    title: "About Legiit",
    intro: ["Legiit is a curated freelance marketplace where business owners and agencies buy work from vetted freelancers. "],
    offerings: [
      {
        heading: "The marketplace",
        paragraphs: ["Vetted freelancers sell productized services on Legiit."],
        links: [{ label: "The marketplace", url: "https://legiit.com" }],
      },
    ],
    differentiators: [{ heading: "The freelancers are vetted", paragraphs: ["Legiit vets freelancers before they can sell."], links: [] }],
    customers: ["Business owners priced out of an agency retainer."],
    founders: [{ heading: "Chris M. Walker, Founder and CEO", paragraphs: ["Chris grew up in North Myrtle Beach."], links: [] }],
    originStory: ["Legiit launched on February 7, 2018."],
    team: [],
    teamSummary: ["Legiit is 45 people across six continents."],
    process: ["For buyers: create an account and search by service or category."],
    stillToFill: [],
  };
}

function faqOutput(): DraftFaqOutput {
  return {
    faq: [
      { question: "Is Legiit the same thing as Fiverr or Upwork?", answer: "No. Fiverr and Upwork are built for volume." },
      { question: "How much does Legiit cost?", answer: "Creating an account is free. Orders start at $6." },
    ],
    closing: ["Think Big."],
  };
}

const usage = { inputTokens: 5_000, outputTokens: 2_000, cacheReadTokens: 3_000, cacheWriteTokens: 0 };

function answer(parsed: unknown) {
  return { parsed, usage, costUsd: 0.0303, durationMs: 1234, model: "claude-sonnet-5-5" as const, stopReason: "end_turn" };
}

const data = loadFixture();
const ctx = { userId: "user-1", projectId: "project-1", generationId: "gen-1", purpose: "" };
const input = { spec: ABOUT_V1, data, siteUrl: "https://legiit.com", companyName: "Legiit", ctx };

beforeEach(() => {
  mocked.mockReset();
});

describe("writeMain", () => {
  it("calls the write model with the main schema and returns the draft with the usage and cost", async () => {
    const out = mainOutput();
    mocked.mockResolvedValue(answer(out));

    const result = await writeMain(input);

    expect(mocked).toHaveBeenCalledTimes(1);
    const opts = mocked.mock.calls[0][0];
    expect(opts).toMatchObject({
      model: "claude-sonnet-5-5",
      maxTokens: config.generate.maxOutputTokens,
      timeoutMs: config.generate.timeoutMs,
      effort: config.generate.effort,
      cacheSystem: true,
      ctx: { userId: "user-1", projectId: "project-1", generationId: "gen-1", purpose: "write_page" },
    });
    expect(opts.model).toBe(config.models.write);
    expect(opts.schema).toBe(DraftMainSchema);
    expect(opts.system).toBe(buildWriterSystemPrompt(ABOUT_V1));
    expect(opts.user).toBe(buildWriterUserPrompt({ ...input, part: "main" }));
    // No thinking setting: Sonnet runs its default, and "disabled" would be rejected.
    expect(opts).not.toHaveProperty("thinking");

    expect(result).toEqual({ draft: draftFromMain(out), usage, costUsd: 0.0303, model: "claude-sonnet-5-5" });
    expect(result.draft.intro).toEqual([out.intro[0].trim()]);
    expect(result.draft.faq).toEqual([]);
    expect(result.draft.closing).toEqual([]);
  });

  it("passes the model's error through", async () => {
    mocked.mockRejectedValue(new Error("529: Overloaded"));
    await expect(writeMain(input)).rejects.toThrow("529: Overloaded");
  });
});

describe("writeFaq", () => {
  it("calls the write model with the faq schema and writes the FAQ onto the draft", async () => {
    const draft = draftFromMain(mainOutput());
    const out = faqOutput();
    mocked.mockResolvedValue(answer(out));

    const result = await writeFaq({ ...input, draft });

    const opts = mocked.mock.calls[0][0];
    expect(opts).toMatchObject({
      model: config.models.write,
      maxTokens: config.generate.maxOutputTokens,
      timeoutMs: config.generate.timeoutMs,
      effort: config.generate.effort,
      cacheSystem: true,
      ctx: { generationId: "gen-1", purpose: "write_faq" },
    });
    expect(opts.schema).toBe(DraftFaqSchema);
    expect(opts.system).toBe(buildWriterSystemPrompt(ABOUT_V1));
    expect(opts.user).toBe(buildWriterUserPrompt({ ...input, part: "faq", draft }));
    expect(opts.user).toContain("Questions already answered on the site");

    expect(result).toEqual({ draft: draftWithFaq(draft, out), usage, costUsd: 0.0303, model: "claude-sonnet-5-5" });
    expect(result.draft.faq).toHaveLength(2);
    expect(result.draft.closing).toEqual(["Think Big."]);
    expect(result.draft.intro).toEqual(draft.intro);
  });
});

describe("rewriteDraft", () => {
  it("calls the write model with the full schema and the lint report", async () => {
    const draft = draftWithFaq(draftFromMain(mainOutput()), faqOutput());
    const report: LintReport = {
      passed: false,
      attempts: 0,
      issues: [{ where: "intro[0]", kind: "banned_word", text: "curated", hint: "Replace the word or cut it." }],
    };
    const out = { ...mainOutput(), ...faqOutput(), intro: ["Legiit is a freelance marketplace."] };
    mocked.mockResolvedValue(answer(out));

    const result = await rewriteDraft({ ...input, draft, report });

    const opts = mocked.mock.calls[0][0];
    expect(opts).toMatchObject({
      model: config.models.write,
      maxTokens: config.generate.maxOutputTokens,
      timeoutMs: config.generate.timeoutMs,
      effort: config.generate.effort,
      cacheSystem: true,
      ctx: { generationId: "gen-1", purpose: "rewrite_page" },
    });
    expect(opts.schema).toBe(DraftFullSchema);
    expect(opts.system).toBe(buildWriterSystemPrompt(ABOUT_V1));
    expect(opts.user).toBe(buildRewritePrompt({ spec: ABOUT_V1, data, draft, report }));
    expect(opts.user).toContain('- intro[0] (banned_word): "curated". Replace the word or cut it.');

    expect(result).toEqual({ draft: draftFromFull(out), usage, costUsd: 0.0303, model: "claude-sonnet-5-5" });
    expect(result.draft.intro).toEqual(["Legiit is a freelance marketplace."]);
    expect(result.draft.faq).toEqual(faqOutput().faq);
  });
});

describe("the three calls together", () => {
  it("share one system prompt, so the prompt cache applies after the first call", async () => {
    mocked.mockResolvedValueOnce(answer(mainOutput()));
    const main = await writeMain(input);
    mocked.mockResolvedValueOnce(answer(faqOutput()));
    const full = await writeFaq({ ...input, draft: main.draft });
    mocked.mockResolvedValueOnce(answer({ ...mainOutput(), ...faqOutput() }));
    await rewriteDraft({ ...input, draft: full.draft, report: { passed: false, attempts: 1, issues: [] } });

    const systems = mocked.mock.calls.map((c) => c[0].system);
    expect(systems).toHaveLength(3);
    expect(new Set(systems).size).toBe(1);
    expect(mocked.mock.calls.map((c) => c[0].ctx.purpose)).toEqual(["write_page", "write_faq", "rewrite_page"]);
  });
});
