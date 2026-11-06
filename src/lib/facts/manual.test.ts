import { describe, expect, it } from "vitest";
import { ABOUT_V1 } from "@/templates/about-v1";
import type { TemplateField, TemplateSpec } from "@/templates/types";
import { emptyFactSheet, questionOrder } from "./manual";
import type { FactField } from "./types";

describe("emptyFactSheet", () => {
  it("targets the template and has every field exactly once", () => {
    const { data } = emptyFactSheet(ABOUT_V1);
    expect(data.templateId).toBe(ABOUT_V1.id);
    expect(Object.keys(data.fields).sort()).toEqual(ABOUT_V1.fields.map((f) => f.id).sort());
  });

  it("marks every field missing, with no value and no evidence", () => {
    const { data } = emptyFactSheet(ABOUT_V1);
    for (const field of Object.values(data.fields)) {
      expect(field).toEqual({ value: null, status: "missing", evidence: [] });
    }
  });

  it("gives each field its own object, so an edit to one cannot leak into another", () => {
    const { data } = emptyFactSheet(ABOUT_V1);
    const [a, b] = Object.values(data.fields);
    expect(a).not.toBe(b);
    a.evidence.push({ quote: "x", url: "", source: "user" });
    expect(b.evidence).toEqual([]);
  });

  it("counts every field as missing and every required field as a required gap, with nothing read", () => {
    const { stats } = emptyFactSheet(ABOUT_V1);
    expect(stats).toEqual({
      found: 0,
      missing: ABOUT_V1.fields.length,
      conflict: 0,
      userProvided: 0,
      requiredMissing: ABOUT_V1.fields.filter((f) => f.required).length,
      pagesUsed: 0,
      findingsTotal: 0,
      findingsDropped: 0,
    });
  });
});

function field(id: string, section: string, required: boolean): TemplateField {
  return { id, section, label: id, type: "text", required, lookFor: "", question: `${id}?`, rendersIn: ["page"] };
}

function withStatus(status: FactField["status"], value: FactField["value"] = "x"): FactField {
  return { value, status, evidence: status === "missing" ? [] : [{ quote: "x", url: "https://a.example/", source: "page" }] };
}

/** Sections declared out of order, and fields mixed across them, so the ordering has to be deliberate. */
const SPEC: TemplateSpec = {
  id: "t",
  version: 1,
  name: "t",
  description: "",
  sections: [
    { id: "late", title: "Late", description: "", order: 2 },
    { id: "early", title: "Early", description: "", order: 1 },
  ],
  fields: [
    field("late_req", "late", true),
    field("late_opt", "late", false),
    field("early_opt_b", "early", false),
    field("early_req", "early", true),
    field("early_opt_a", "early", false),
    field("early_req_2", "early", true),
    field("late_opt_2", "late", false),
  ],
  keyFactsRows: [],
  faq: { min: 10, max: 12, answerSentencesMin: 2, answerSentencesMax: 3 },
  schema: { orgTypes: [], localBusinessTypes: [] },
};

const ids = (fields: TemplateField[]) => fields.map((f) => f.id);

describe("questionOrder", () => {
  it("asks required fields first, each group in section order and then spec order", () => {
    expect(ids(questionOrder(SPEC, {}))).toEqual([
      "early_req",
      "early_req_2",
      "late_req",
      "early_opt_b",
      "early_opt_a",
      "late_opt",
      "late_opt_2",
    ]);
  });

  it("leaves out fields that are found, contradicted, or answered by the owner", () => {
    const order = questionOrder(SPEC, {
      early_req_2: withStatus("found"),
      late_opt: withStatus("conflict", null),
      early_opt_a: withStatus("user_provided"),
    });
    expect(ids(order)).toEqual(["early_req", "late_req", "early_opt_b", "late_opt_2"]);
  });

  it("treats a field with no entry the same as one marked missing", () => {
    const explicit = questionOrder(SPEC, Object.fromEntries(SPEC.fields.map((f) => [f.id, withStatus("missing", null)])));
    expect(ids(explicit)).toEqual(ids(questionOrder(SPEC, {})));
  });

  it("returns nothing when every field has an answer", () => {
    expect(questionOrder(SPEC, Object.fromEntries(SPEC.fields.map((f) => [f.id, withStatus("found")])))).toEqual([]);
  });

  it("walks the whole empty about-v1 sheet, starting with the company name", () => {
    const { data } = emptyFactSheet(ABOUT_V1);
    const order = questionOrder(ABOUT_V1, data.fields);
    expect(order.length).toBe(ABOUT_V1.fields.length);
    expect(order[0]?.id).toBe("company_name");
    const required = ABOUT_V1.fields.filter((f) => f.required).length;
    expect(order.findIndex((f) => !f.required)).toBe(required);
    expect(order.slice(0, required).every((f) => f.required)).toBe(true);
  });
});
