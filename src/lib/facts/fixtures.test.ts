import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ABOUT_V1 } from "@/templates/about-v1";
import type { FactSheetData, FactField, ListItem } from "./types";

const FIXTURES = ["legiit", "darcy-bailey"] as const;

function loadFixture(name: (typeof FIXTURES)[number]): FactSheetData {
  const file = path.join(process.cwd(), "examples", "fixtures", `${name}.factsheet.json`);
  return JSON.parse(readFileSync(file, "utf8")) as FactSheetData;
}

const VALID_STATUS = new Set(["found", "missing", "conflict", "user_provided"]);
const VALID_SOURCE = new Set(["page", "jsonld", "link", "meta", "image", "user"]);

function isListItemArray(v: unknown): v is ListItem[] {
  return Array.isArray(v) && v.every((i) => typeof i === "object" && i !== null && !Array.isArray(i));
}

function countConflicts(data: FactSheetData): number {
  return Object.values(data.fields).reduce(
    (n, f) => n + (f.status === "conflict" ? 1 : 0) + (f.itemConflicts?.length ?? 0),
    0,
  );
}

describe.each(FIXTURES)("fixture %s", (name) => {
  const data = loadFixture(name);
  const specFields = new Map(ABOUT_V1.fields.map((f) => [f.id, f]));

  it("targets the about-v1 template", () => {
    expect(data.templateId).toBe(ABOUT_V1.id);
  });

  it("has every template field exactly once and nothing else", () => {
    const ids = Object.keys(data.fields);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(specFields.has(id), `unknown field ${id}`).toBe(true);
    for (const f of ABOUT_V1.fields) expect(data.fields[f.id], `missing field ${f.id}`).toBeDefined();
  });

  it("uses valid statuses, sources, and evidence shapes", () => {
    for (const [id, field] of Object.entries(data.fields)) {
      expect(VALID_STATUS.has(field.status), `${id} status ${field.status}`).toBe(true);
      expect(Array.isArray(field.evidence)).toBe(true);
      for (const e of field.evidence) {
        expect(typeof e.quote === "string" && e.quote.length > 0, `${id} evidence quote`).toBe(true);
        expect(typeof e.url, `${id} evidence url`).toBe("string");
        expect(VALID_SOURCE.has(e.source), `${id} evidence source ${e.source}`).toBe(true);
        if (e.source !== "user") expect(e.url.startsWith("http"), `${id} evidence url ${e.url}`).toBe(true);
      }
      if (field.status === "missing") {
        expect(field.value).toBeNull();
        expect(field.evidence.length).toBe(0);
      } else {
        expect(field.value, `${id} has no value`).not.toBeNull();
        expect(field.evidence.length, `${id} has no evidence`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps list items to the template's item shape", () => {
    for (const [id, field] of Object.entries(data.fields)) {
      const spec = specFields.get(id)!;
      if (spec.type !== "list" || field.value === null) continue;
      expect(isListItemArray(field.value), `${id} value is a list`).toBe(true);
      const allowed = new Set(spec.itemShape!.map((s) => s.key));
      const required = spec.itemShape!.filter((s) => s.required).map((s) => s.key);
      for (const item of field.value as ListItem[]) {
        for (const key of Object.keys(item)) expect(allowed.has(key), `${id} item key ${key}`).toBe(true);
        for (const key of required) {
          expect(typeof item[key] === "string" && item[key]!.length > 0, `${id} item ${key} required`).toBe(true);
        }
      }
      for (const c of field.itemConflicts ?? []) {
        expect(c.candidates.length).toBeGreaterThanOrEqual(2);
        for (const cand of c.candidates) {
          expect(cand.evidence.length).toBeGreaterThan(0);
          for (const item of cand.value as ListItem[]) {
            for (const key of Object.keys(item)) expect(allowed.has(key), `${id} conflict item key ${key}`).toBe(true);
          }
        }
      }
    }
  });

  it("gives every conflict at least two candidates with evidence", () => {
    for (const [id, field] of Object.entries(data.fields)) {
      if (field.status !== "conflict") continue;
      expect(field.candidates?.length ?? 0, `${id} candidates`).toBeGreaterThanOrEqual(2);
      for (const c of field.candidates!) expect(c.evidence.length, `${id} candidate evidence`).toBeGreaterThan(0);
    }
  });

  it("uses the address keys for the headquarters", () => {
    const hq = data.fields.headquarters as FactField;
    if (hq.value === null) return;
    const allowed = new Set([...ABOUT_V1.fields.find((f) => f.id === "headquarters")!.addressKeys!, "text"]);
    for (const key of Object.keys(hq.value as Record<string, unknown>)) expect(allowed.has(key)).toBe(true);
  });
});

describe("fixture coverage", () => {
  it("legiit carries the thirteen answers from the question list", () => {
    const data = loadFixture("legiit");
    const userEvidence = Object.values(data.fields).flatMap((f) => f.evidence).filter((e) => e.source === "user");
    expect(userEvidence.length).toBeGreaterThanOrEqual(13);
    expect(Object.values(data.fields).filter((f) => f.status === "user_provided").length).toBeGreaterThanOrEqual(4);
  });

  it("darcy-bailey exercises conflicts and missing fields", () => {
    const data = loadFixture("darcy-bailey");
    expect(countConflicts(data)).toBeGreaterThanOrEqual(4);
    expect(Object.values(data.fields).filter((f) => f.status === "missing").length).toBeGreaterThanOrEqual(5);
    expect(data.fields.years_in_business.candidates?.length).toBe(3);
    expect(data.fields.pricing.itemConflicts?.some((c) => c.on.includes("price"))).toBe(true);
    expect(data.fields.team_members.itemConflicts?.some((c) => c.on.includes("name"))).toBe(true);
  });
});
