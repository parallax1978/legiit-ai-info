import { describe, expect, it } from "vitest";
import { ABOUT_V1 } from "@/templates/about-v1";
import { ExtractionOutputSchema, toFindings, type ExtractionOutput } from "./schema";

const url = "https://darcybaileycounselling.com/contact/";

function output(findings: ExtractionOutput["findings"]): ExtractionOutput {
  return { findings, page_summary: "The contact page.", business_name_guess: "Darcy Bailey & Associates Counselling" };
}

const base = { item: [], note: "", confidence: 0.9 };

describe("ExtractionOutputSchema", () => {
  it("parses a complete output and rejects a missing property", () => {
    const ok = ExtractionOutputSchema.safeParse(
      output([{ ...base, field_id: "phone", kind: "scalar", value: "604-533-9163", quote: "Call 604-533-9163" }]),
    );
    expect(ok.success).toBe(true);
    const bad = ExtractionOutputSchema.safeParse({ findings: [{ field_id: "phone" }], page_summary: "" });
    expect(bad.success).toBe(false);
  });
});

describe("toFindings", () => {
  it("maps a scalar finding", () => {
    const findings = toFindings(
      output([{ ...base, field_id: "phone", kind: "scalar", value: "604-533-9163", quote: "Call 604-533-9163" }]),
      { url, spec: ABOUT_V1 },
    );
    expect(findings).toEqual([
      { fieldId: "phone", value: "604-533-9163", quote: "Call 604-533-9163", url, source: "page", confidence: 0.9 },
    ]);
  });

  it("maps a list item, keeps only item-shape keys, and drops items missing a required key", () => {
    const findings = toFindings(
      output([
        {
          ...base,
          field_id: "services",
          kind: "list_item",
          value: "",
          item: [
            { key: "name", value: " Couples counselling " },
            { key: "description", value: "Counselling for communication breakdowns, trust after infidelity, and intimacy." },
            { key: "price", value: "$195 for 50 minutes" },
            { key: "colour", value: "purple" },
          ],
          quote: "Couples sessions are $195 for 50 minutes",
        },
        {
          ...base,
          field_id: "services",
          kind: "list_item",
          value: "",
          item: [{ key: "name", value: "EMDR therapy" }],
          quote: "EMDR therapy",
        },
      ]),
      { url, spec: ABOUT_V1 },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].value).toEqual([
      {
        name: "Couples counselling",
        description: "Counselling for communication breakdowns, trust after infidelity, and intimacy.",
        price: "$195 for 50 minutes",
      },
    ]);
  });

  it("maps an address with its parts and the one-line text", () => {
    const findings = toFindings(
      output([
        {
          ...base,
          field_id: "headquarters",
          kind: "address",
          value: "#315 - 20385 64 Avenue, Langley, BC V2Y 1N5",
          item: [
            { key: "streetAddress", value: "#315 - 20385 64 Avenue" },
            { key: "addressLocality", value: "Langley" },
            { key: "addressRegion", value: "BC" },
            { key: "postalCode", value: "V2Y 1N5" },
            { key: "addressCountry", value: "Canada" },
          ],
          quote: "#315 - 20385 64 Avenue, Langley, BC V2Y 1N5",
        },
      ]),
      { url, spec: ABOUT_V1 },
    );
    expect(findings[0].value).toEqual({
      streetAddress: "#315 - 20385 64 Avenue",
      addressLocality: "Langley",
      addressRegion: "BC",
      postalCode: "V2Y 1N5",
      addressCountry: "Canada",
      text: "#315 - 20385 64 Avenue, Langley, BC V2Y 1N5",
    });
  });

  it("drops unknown field ids, empty quotes, and low confidence; clamps confidence; keeps notes", () => {
    const findings = toFindings(
      output([
        { ...base, field_id: "favourite_colour", kind: "scalar", value: "purple", quote: "purple" },
        { ...base, field_id: "phone", kind: "scalar", value: "604-533-9163", quote: "   " },
        { ...base, field_id: "phone", kind: "scalar", value: "604-533-9163", quote: "604-533-9163", confidence: 0.1 },
        {
          ...base,
          field_id: "years_in_business",
          kind: "scalar",
          value: "over 17 years",
          quote: "serving Langley for over 17 years",
          confidence: 1.4,
          note: "another page says 19 years",
        },
      ]),
      { url, spec: ABOUT_V1 },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      fieldId: "years_in_business",
      value: "over 17 years",
      confidence: 1,
      note: "another page says 19 years",
    });
  });

  it("copes with a mislabelled kind", () => {
    const findings = toFindings(
      output([
        { ...base, field_id: "competitors", kind: "scalar", value: "Fiverr", quote: "Fiverr and Upwork" },
        {
          ...base,
          field_id: "team_size",
          kind: "list_item",
          value: "",
          item: [{ key: "count", value: "45 people" }],
          quote: "a team of 45 people",
        },
      ]),
      { url, spec: ABOUT_V1 },
    );
    expect(findings[0].value).toEqual([{ name: "Fiverr" }]);
    expect(findings[1].value).toBe("45 people");
  });
});
