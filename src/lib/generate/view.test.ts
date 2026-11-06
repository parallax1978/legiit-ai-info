import { describe, expect, it } from "vitest";
import type { GenerationRow } from "@/lib/db/types";
import type { FactSheetData } from "@/lib/facts/types";
import type { TemplateField, TemplateSpec } from "@/templates/types";
import type { PageDraft } from "./types";
import {
  describeLintWhere,
  draftOf,
  fieldQuestions,
  formatCost,
  generationCursorOf,
  generationStepIndex,
  generationViewFromRow,
  isGenerationFinished,
  lintIssueViews,
  lintReportOf,
  missingRequiredFields,
  questionsById,
  reviewHref,
  stalledGenerationMessage,
  stillToFillIds,
  stillToFillOf,
} from "./view";

function row(partial: Partial<GenerationRow> = {}): GenerationRow {
  return {
    id: "gen-1",
    project_id: "project-1",
    user_id: "user-1",
    version: 1,
    fact_sheet_id: "sheet-1",
    fact_sheet_version: 1,
    status: "queued",
    page_html: null,
    wordpress_html: null,
    schema: null,
    instructions_md: null,
    still_to_fill: [],
    lint_report: {},
    model: null,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    error: null,
    draft: null,
    cursor: {},
    log: [],
    locked_at: null,
    lock_token: null,
    attempts: 0,
    title: null,
    meta_description: null,
    platform: "unknown",
    page_url: "https://example.com/about",
    created_at: "2026-11-06T00:00:00Z",
    updated_at: "2026-11-06T00:00:00Z",
    ...partial,
  };
}

const draft: PageDraft = {
  metaTitle: "About Acme Roofing: Roofers in Dayton Since 1998",
  metaDescription: "Acme Roofing replaces and repairs roofs in Dayton, Ohio.",
  title: "About Acme Roofing",
  intro: ["Acme Roofing is a family-run roofing company in Dayton, Ohio."],
  offerings: [{ heading: "Roof replacement", paragraphs: ["Acme Roofing replaces roofs."] }],
  differentiators: [{ heading: "Family run since 1998", paragraphs: ["The company has replaced 4,000 roofs."] }],
  customers: ["Homeowners in the Miami Valley"],
  founders: [{ heading: "Jane Acme, Owner", paragraphs: ["Jane started the company."], links: [{ label: "LinkedIn", url: "https://linkedin.com/in/jane" }] }],
  originStory: [],
  team: [],
  teamSummary: [],
  process: ["Call for a free inspection."],
  faq: [{ question: "Does Acme Roofing offer free inspections?", answer: "Yes. Call to book one." }],
  closing: ["Call Acme Roofing for a free inspection."],
  stillToFill: ["mission"],
};

function field(partial: Partial<TemplateField> & Pick<TemplateField, "id" | "section">): TemplateField {
  return {
    label: partial.id,
    type: "text",
    required: false,
    lookFor: "",
    question: `What is the ${partial.id} of [COMPANY]?`,
    rendersIn: ["page"],
    ...partial,
  };
}

const spec: TemplateSpec = {
  id: "test-v1",
  version: 1,
  name: "Test",
  description: "",
  sections: [
    { id: "basics", title: "The basics", description: "", order: 1 },
    { id: "team", title: "The team", description: "", order: 2 },
  ],
  fields: [
    field({ id: "company_name", section: "basics", required: true, label: "Company name", question: "What name should the page use?" }),
    field({ id: "category", section: "basics", required: true, label: "Category" }),
    field({ id: "mission", section: "basics", label: "Mission" }),
    field({ id: "founders", section: "team", type: "list", required: true, label: "Founders" }),
  ],
  keyFactsRows: [],
  faq: { min: 10, max: 12, answerSentencesMin: 2, answerSentencesMax: 3 },
  schema: { orgTypes: [], localBusinessTypes: [] },
};

const data: FactSheetData = {
  templateId: spec.id,
  fields: {
    company_name: { value: "Acme Roofing", status: "found", evidence: [] },
    category: { value: null, status: "missing", evidence: [] },
    mission: { value: null, status: "missing", evidence: [] },
    founders: { value: [{ name: "Jane Acme" }], status: "conflict", evidence: [] },
  },
};

describe("generationViewFromRow", () => {
  it("waits at 0.05 while queued and is not finished", () => {
    const v = generationViewFromRow(row());
    expect(v.progress).toBe(0.05);
    expect(v.phase).toBe("queued");
    expect(v.part).toBe("main");
    expect(v.message).toBe("Waiting to start");
    expect(v.hasPage).toBe(false);
    expect(isGenerationFinished(v)).toBe(false);
    expect(generationStepIndex(v)).toBe(0);
  });

  it("writes the page first", () => {
    const v = generationViewFromRow(row({ status: "writing", cursor: { part: "main" } }));
    expect(v.progress).toBe(0.1);
    expect(v.message).toBe("Writing the page");
    expect(generationStepIndex(v)).toBe(0);
  });

  it("moves to the questions once the main sections are done", () => {
    const v = generationViewFromRow(row({ status: "writing", cursor: { part: "faq" } }));
    expect(v.progress).toBe(0.35);
    expect(v.part).toBe("faq");
    expect(v.message).toBe("Writing the questions people ask");
    expect(generationStepIndex(v)).toBe(1);
  });

  it("checks the copy once the questions are done", () => {
    const v = generationViewFromRow(row({ status: "linting", cursor: { part: "lint", lintAttempts: 1 } }));
    expect(v.progress).toBe(0.65);
    expect(v.part).toBe("lint");
    expect(v.message).toBe("Checking the copy");
    expect(generationStepIndex(v)).toBe(2);
  });

  it("builds the files once the copy passed", () => {
    const v = generationViewFromRow(row({ status: "linting", cursor: { part: "finish" } }));
    expect(v.progress).toBe(0.85);
    expect(v.part).toBe("finish");
    expect(v.message).toBe("Building the schema and the files");
    expect(generationStepIndex(v)).toBe(3);
  });

  it("does not let the cursor send a status backwards or forwards", () => {
    expect(generationViewFromRow(row({ status: "writing", cursor: { part: "finish" } })).part).toBe("main");
    expect(generationViewFromRow(row({ status: "linting", cursor: { part: "main" } })).part).toBe("lint");
    expect(generationViewFromRow(row({ status: "writing", cursor: "nonsense" })).part).toBe("main");
  });

  it("is done at 1 with the page, the title, the cost, and the report", () => {
    const v = generationViewFromRow(
      row({
        status: "done",
        page_html: "<!DOCTYPE html><html></html>",
        title: " About Acme Roofing ",
        cost_usd: 0.0812,
        lint_report: { passed: false, attempts: 2, issues: [{ where: "intro[0]", kind: "dash", text: "a - b", hint: "Use a comma." }] },
        still_to_fill: ["mission", 7, null],
      }),
    );
    expect(v.progress).toBe(1);
    expect(v.message).toBe("Your page is ready");
    expect(v.hasPage).toBe(true);
    expect(v.title).toBe("About Acme Roofing");
    expect(v.costUsd).toBeCloseTo(0.0812, 6);
    expect(v.lintIssues).toBe(1);
    expect(v.lintPassed).toBe(false);
    expect(v.stillToFill).toEqual(["mission"]);
    expect(isGenerationFinished(v)).toBe(true);
    expect(generationStepIndex(v)).toBe(4);
  });

  it("reads a numeric cost that PostgREST returns as a string", () => {
    const v = generationViewFromRow(row({ cost_usd: "0.05" as unknown as number }));
    expect(v.costUsd).toBe(0.05);
  });

  it("reports the error when failed and keeps nothing of the progress", () => {
    const v = generationViewFromRow(row({ status: "failed", error: "The model declined this request.", cursor: { part: "faq" } }));
    expect(v.progress).toBe(0);
    expect(v.message).toBe("The model declined this request.");
    expect(v.part).toBe("faq");
    expect(isGenerationFinished(v)).toBe(true);
    expect(generationStepIndex(v)).toBe(-1);
    expect(generationViewFromRow(row({ status: "failed" })).message).toBe("The page could not be written");
  });

  it("copies the log and tolerates a lint report that is not one", () => {
    const log = [{ at: "2026-11-06T00:00:00Z", level: "info" as const, message: "Wrote the page" }];
    const v = generationViewFromRow(row({ log, lint_report: "nope" }));
    expect(v.log).toEqual(log);
    expect(v.lintIssues).toBe(0);
    expect(v.lintPassed).toBeNull();
  });
});

describe("the row's JSON columns", () => {
  it("reads the cursor without trusting its shape", () => {
    expect(generationCursorOf({ part: "lint", lintAttempts: 2, attempts: "3", errorCount: 1 })).toEqual({
      part: "lint",
      lintAttempts: 2,
      errorCount: 1,
    });
    expect(generationCursorOf({ part: "nope" })).toEqual({});
    expect(generationCursorOf(null)).toEqual({});
    expect(generationCursorOf([1])).toEqual({});
  });

  it("drops lint issues of an unknown kind and reports that are not reports", () => {
    const report = lintReportOf({
      passed: false,
      attempts: 1,
      issues: [
        { where: "faq[3].answer", kind: "banned_word", text: "seamless", hint: "Say what it does." },
        { where: "intro[0]", kind: "made_up", text: "x", hint: "y" },
        "not an issue",
      ],
    });
    expect(report).toEqual({
      passed: false,
      attempts: 1,
      issues: [{ where: "faq[3].answer", kind: "banned_word", text: "seamless", hint: "Say what it does." }],
    });
    expect(lintReportOf({})).toBeNull();
    expect(lintReportOf({ passed: true })).toEqual({ passed: true, issues: [], attempts: 0 });
  });

  it("keeps only strings in still_to_fill", () => {
    expect(stillToFillOf(["mission", "", 3, { id: "x" }])).toEqual(["mission"]);
    expect(stillToFillOf({})).toEqual([]);
  });

  it("reads a stored draft back and rejects one that is not in shape", () => {
    expect(draftOf(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(draftOf(null)).toBeNull();
    expect(draftOf({ ...draft, faq: "none" } as unknown as Record<string, never>)).toBeNull();
    expect(draftOf({ ...draft, offerings: [{ heading: "x" }] } as unknown as Record<string, never>)).toBeNull();
    // Links that are not label and url pairs are dropped; the item is kept.
    const loose = { ...draft, founders: [{ heading: "Jane", paragraphs: [], links: [{ label: "x" }, { label: "y", url: "https://y" }] }] };
    expect(draftOf(loose as unknown as Record<string, never>)?.founders[0].links).toEqual([{ label: "y", url: "https://y" }]);
  });
});

describe("fields", () => {
  it("lists the required fields with no value, with the company name filled in", () => {
    expect(missingRequiredFields(spec, data, "Acme Roofing")).toEqual([
      { id: "category", label: "Category", section: "basics", question: "What is the category of Acme Roofing?" },
    ]);
    expect(missingRequiredFields(spec, { templateId: spec.id, fields: {} }, null).map((f) => f.id)).toEqual([
      "company_name",
      "category",
      "founders",
    ]);
    expect(missingRequiredFields(spec, null, null)).toHaveLength(3);
  });

  it("unions the writer's still-to-fill ids with the open required fields, in spec order", () => {
    const inSpecOrder = (ids: string[]) => spec.fields.filter((f) => ids.includes(f.id)).map((f) => f.id);
    // category is required and missing; founders is required and an unresolved conflict: both are open.
    expect(stillToFillIds(spec, data, draft)).toEqual(inSpecOrder(["category", "mission", "founders"]));
    expect(stillToFillIds(spec, data, { stillToFill: ["unknown_field", "founders"] })).toEqual(inSpecOrder(["category", "founders"]));
    // A field the writer lists but the fact sheet has a value for is not still to fill.
    expect(stillToFillIds(spec, data, { stillToFill: ["company_name"] })).toEqual(inSpecOrder(["category", "founders"]));
  });

  it("maps ids to questions and leaves unknown ids out", () => {
    expect(fieldQuestions(spec, ["mission", "nope"], "Acme Roofing")).toEqual([
      { id: "mission", label: "Mission", section: "basics", question: "What is the mission of Acme Roofing?" },
    ]);
    expect(questionsById(spec, ["company_name"], null)).toEqual({ company_name: "What name should the page use?" });
  });

  it("links back to the review screen", () => {
    expect(reviewHref("p1")).toBe("/app/projects/p1");
    expect(reviewHref("p1", { fieldId: "mission" })).toBe("/app/projects/p1#field-mission");
    expect(reviewHref("p1", { section: "team" })).toBe("/app/projects/p1#section-team");
  });
});

describe("lint issues in plain words", () => {
  it("describes where an issue is", () => {
    expect(describeLintWhere("intro[0]")).toBe("Intro, paragraph 1");
    expect(describeLintWhere("offerings[2].paragraphs[1]")).toBe("What it does, item 3, paragraph 2");
    expect(describeLintWhere("faq[3].answer")).toBe("Question 4, answer");
    expect(describeLintWhere("founders[0].heading")).toBe("Founders, item 1, heading");
    expect(describeLintWhere("metaTitle")).toBe("Title tag");
    expect(describeLintWhere("customers[1]")).toBe("Who uses it, item 2");
    expect(describeLintWhere("faq")).toBe("Question");
    expect(describeLintWhere("")).toBe("the page");
  });

  it("renders a report for the screen", () => {
    const views = lintIssueViews({
      passed: false,
      attempts: 2,
      issues: [{ where: "closing[0]", kind: "exclamation", text: "Call today!", hint: "Use a full stop." }],
    });
    expect(views).toEqual([{ where: "Closing, line 1", kind: "An exclamation mark", text: "Call today!", hint: "Use a full stop." }]);
    expect(lintIssueViews(null)).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats costs", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("under $0.01");
    expect(formatCost(0.0812)).toBe("$0.08");
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("explains a stalled generation", () => {
    expect(stalledGenerationMessage("faq")).toBe(
      "The page writer kept running out of time while writing the questions people ask. Try it again later.",
    );
    expect(stalledGenerationMessage(null)).toMatch(/while writing the page/);
  });
});
