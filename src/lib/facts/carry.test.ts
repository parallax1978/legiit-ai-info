import { describe, expect, it } from "vitest";
import { carryUserEdits } from "./carry";
import { emptyField, type FactField, type FactSheetData } from "./types";

const page = (quote: string): FactField["evidence"][number] => ({ quote, url: "https://acme.example.com/about", source: "page" });

function sheet(fields: Record<string, FactField>, templateId = "about-v1"): FactSheetData {
  return { templateId, fields };
}

const found = (value: string, quote = value): FactField => ({ value, status: "found", evidence: [page(quote)] });

describe("carryUserEdits", () => {
  const typed: FactField = {
    value: "No contracts. Every job gets a written quote.",
    status: "user_provided",
    evidence: [page("Free quotes"), { quote: "No contracts. Every job gets a written quote.", url: "", source: "user" }],
    note: "Checked with the owner",
    updatedAt: "2026-11-06T10:00:00.000Z",
    crawled: { value: null, status: "missing", evidence: [] },
  };
  const picked: FactField = {
    value: "(937) 555-0142",
    status: "user_provided",
    evidence: [page("(937) 555-0142")],
    updatedAt: "2026-11-06T10:01:00.000Z",
    crawled: {
      value: null,
      status: "conflict",
      evidence: [],
      candidates: [
        { value: "(937) 555-0142", evidence: [page("(937) 555-0142")] },
        { value: "(937) 555-0199", evidence: [page("(937) 555-0199")] },
      ],
    },
  };

  it("keeps a typed value and a picked candidate, with the new scan's result under crawled", () => {
    const fresh = sheet({
      contract_terms: emptyField(),
      phone: {
        value: null,
        status: "conflict",
        evidence: [],
        candidates: [
          { value: "(937) 555-0142", evidence: [page("(937) 555-0142")] },
          { value: "(937) 555-0199", evidence: [page("(937) 555-0199")] },
        ],
      },
      company_name: found("Acme Roofing"),
    });
    const { data, carried } = carryUserEdits(sheet({ contract_terms: typed, phone: picked, company_name: found("Acme") }), fresh);

    expect(carried).toEqual(["contract_terms", "phone"]);
    expect(data.fields.contract_terms).toEqual({
      value: typed.value,
      status: "user_provided",
      evidence: typed.evidence,
      note: "Checked with the owner",
      updatedAt: typed.updatedAt,
      crawled: { value: null, status: "missing", evidence: [] },
    });
    expect(data.fields.phone).toMatchObject({ value: "(937) 555-0142", status: "user_provided" });
    expect(data.fields.phone.crawled).toEqual({
      value: null,
      status: "conflict",
      evidence: [],
      candidates: fresh.fields.phone.candidates,
    });
    expect(data.fields.phone.candidates).toBeUndefined();
    // A field the owner never touched takes the new scan's result.
    expect(data.fields.company_name).toBe(fresh.fields.company_name);
    expect(data.templateId).toBe("about-v1");
  });

  it("does not share objects with the previous sheet", () => {
    const prev = sheet({ contract_terms: typed });
    const { data } = carryUserEdits(prev, sheet({ contract_terms: emptyField() }));
    (data.fields.contract_terms.evidence as unknown[]).push("changed");
    expect(prev.fields.contract_terms.evidence).toHaveLength(2);
  });

  it("carries nothing from a field the owner cleared, a field the new sheet lacks, or another template", () => {
    const restored: FactField = { ...found("Dayton"), updatedAt: "2026-11-06T10:02:00.000Z" };
    const prev = sheet({ city: restored, contract_terms: typed, mission: { ...typed, value: "Keep Dayton dry." } });
    const fresh = sheet({ city: found("Dayton, Ohio"), contract_terms: emptyField() });

    const same = carryUserEdits(prev, fresh);
    expect(same.carried).toEqual(["contract_terms"]);
    expect(same.data.fields.city).toBe(fresh.fields.city);
    expect(same.data.fields.mission).toBeUndefined();

    const other = carryUserEdits({ ...prev, templateId: "about-v2" }, fresh);
    expect(other.carried).toEqual([]);
    expect(other.data).toBe(fresh);

    expect(carryUserEdits(null, fresh)).toEqual({ data: fresh, carried: [] });
    expect(carryUserEdits(undefined, fresh)).toEqual({ data: fresh, carried: [] });
  });

  it("keeps a manual answer when the first scan runs on a project filled in by hand", () => {
    const answered: FactField = {
      value: [{ name: "Maria Lopez", title: "Owner" }],
      status: "user_provided",
      evidence: [{ quote: "Maria Lopez, Owner", url: "", source: "user" }],
      updatedAt: "2026-11-06T09:00:00.000Z",
    };
    const fresh = sheet({ founders: found("x"), company_name: found("Acme Roofing") });
    fresh.fields.founders = { value: [{ name: "M. Lopez" }], status: "found", evidence: [page("M. Lopez")] };
    const { data, carried } = carryUserEdits(sheet({ founders: answered, company_name: emptyField() }), fresh);
    expect(carried).toEqual(["founders"]);
    expect(data.fields.founders).toMatchObject({ value: [{ name: "Maria Lopez", title: "Owner" }], status: "user_provided" });
    expect(data.fields.founders.crawled).toEqual({ value: [{ name: "M. Lopez" }], status: "found", evidence: [page("M. Lopez")] });
    expect(data.fields.company_name).toMatchObject({ status: "found", value: "Acme Roofing" });
  });
});
