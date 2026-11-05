import { describe, expect, it } from "vitest";
import type { CrawlRunRow } from "@/lib/db/types";
import type { FactSheetData } from "@/lib/facts/types";
import type { TemplateField, TemplateSpec } from "@/templates/types";
import {
  addressFromLine,
  addressFromParts,
  addressLines,
  candidateItemSummary,
  completion,
  conflictForItem,
  fillCompany,
  formatValue,
  hostPath,
  isEmptyValue,
  isOneLineAddress,
  isRunFinished,
  listLayout,
  normalizeFields,
  pageLabelFromUrl,
  runViewFromRow,
  schemaGroups,
  sectionCounts,
  sourceLabel,
  statusCounts,
  undoForUserValue,
  urlKey,
} from "./view";

function row(partial: Partial<CrawlRunRow> = {}): CrawlRunRow {
  return {
    id: "run-1",
    project_id: "project-1",
    user_id: "user-1",
    status: "running",
    phase: "discover",
    cursor: {},
    pages_planned: 0,
    pages_fetched: 0,
    pages_failed: 0,
    pages_extracted: 0,
    text_bytes: 0,
    platform: "unknown",
    platform_evidence: [],
    robots: null,
    sitemaps: [],
    log: [],
    error: null,
    locked_at: null,
    lock_token: null,
    started_at: null,
    finished_at: null,
    cost_usd: 0,
    fact_sheet_id: null,
    created_at: "2026-11-05T00:00:00Z",
    updated_at: "2026-11-05T00:00:00Z",
    ...partial,
  };
}

function field(partial: Partial<TemplateField> & Pick<TemplateField, "id" | "section" | "type">): TemplateField {
  return {
    label: partial.id,
    required: false,
    lookFor: "",
    question: `What is the ${partial.id}?`,
    rendersIn: ["page"],
    ...partial,
  };
}

const services = field({
  id: "services",
  section: "offerings",
  type: "list",
  required: true,
  itemShape: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "price", label: "Price", type: "text" },
  ],
  dedupeKey: "name",
  conflictOn: ["price"],
});

const spec: TemplateSpec = {
  id: "test-v1",
  version: 1,
  name: "Test",
  description: "",
  sections: [
    { id: "offerings", title: "What it does", description: "Services.", order: 2 },
    { id: "basics", title: "The basics", description: "Name and contact.", order: 1 },
  ],
  fields: [
    field({ id: "company_name", section: "basics", type: "text", required: true, question: "What name should [COMPANY] use?" }),
    field({ id: "phone", section: "basics", type: "phone" }),
    field({ id: "headquarters", section: "basics", type: "address", required: true }),
    services,
  ],
  keyFactsRows: [],
  faq: { min: 1, max: 1, answerSentencesMin: 1, answerSentencesMax: 1 },
  schema: { orgTypes: [], localBusinessTypes: [] },
};

const data: FactSheetData = {
  templateId: spec.id,
  fields: {
    company_name: { value: "Legiit", status: "found", evidence: [{ quote: "Legiit", url: "https://legiit.com/", source: "page" }] },
    phone: { value: null, status: "missing", evidence: [] },
    services: {
      value: [{ name: "SEO", price: "$6" }],
      status: "conflict",
      evidence: [],
      candidates: [
        { value: [{ name: "SEO", price: "$6" }], evidence: [] },
        { value: [{ name: "SEO", price: "$9" }], evidence: [] },
      ],
    },
  },
};

describe("runViewFromRow", () => {
  it("is at zero while queued", () => {
    const v = runViewFromRow(row({ status: "queued" }));
    expect(v.progress).toBe(0);
    expect(v.done).toBe(false);
    expect(v.message).toBe("Waiting to start");
  });

  it("sits at 0.05 while discovering", () => {
    const v = runViewFromRow(row({ phase: "discover" }));
    expect(v.progress).toBe(0.05);
    expect(v.message).toBe("Finding pages on the site");
  });

  it("moves through 0.05..0.6 while fetching and names the next page", () => {
    const v = runViewFromRow(
      row({
        phase: "fetch",
        pages_planned: 31,
        pages_fetched: 12,
        cursor: { queue: [{ url: "https://example.com/pricing/", rank: 13, reason: "pricing" }] },
      }),
    );
    expect(v.progress).toBeCloseTo(0.05 + 0.55 * (12 / 31), 3);
    expect(v.message).toBe("Reading the pricing page (13 of 31)");
  });

  it("counts failed pages toward the current page number", () => {
    const v = runViewFromRow(
      row({
        phase: "fetch",
        pages_planned: 10,
        pages_fetched: 3,
        pages_failed: 2,
        cursor: { queue: [{ url: "https://example.com/", rank: 6, reason: "home" }] },
      }),
    );
    expect(v.message).toBe("Reading the home page (6 of 10)");
  });

  it("falls back to a plain count when the queue is empty", () => {
    const v = runViewFromRow(row({ phase: "fetch", pages_planned: 31, pages_fetched: 31, cursor: {} }));
    expect(v.progress).toBeCloseTo(0.6, 3);
    expect(v.message).toBe("Reading pages (31 of 31)");
  });

  it("moves through 0.6..0.95 while extracting", () => {
    const v = runViewFromRow(row({ phase: "extract", pages_planned: 31, pages_fetched: 30, pages_extracted: 10 }));
    expect(v.progress).toBeCloseTo(0.6 + 0.35 * (10 / 31), 3);
    expect(v.message).toBe("Pulling facts from page 11 of 30");
  });

  it("sits at 0.97 while merging", () => {
    const v = runViewFromRow(row({ phase: "merge", pages_planned: 5, pages_fetched: 5, pages_extracted: 5 }));
    expect(v.progress).toBe(0.97);
    expect(v.message).toBe("Putting the fact sheet together");
  });

  it("is done at 1 with the fact sheet id", () => {
    const v = runViewFromRow(row({ status: "done", phase: "done", pages_fetched: 30, fact_sheet_id: "fs-1" }));
    expect(v.progress).toBe(1);
    expect(v.done).toBe(true);
    expect(v.factSheetId).toBe("fs-1");
    expect(v.message).toBe("Scan complete: 30 pages read");
    expect(isRunFinished(v)).toBe(true);
  });

  it("reports the error when failed and is not done", () => {
    const v = runViewFromRow(row({ status: "failed", phase: "failed", error: "robots.txt blocks us" }));
    expect(v.done).toBe(false);
    expect(v.progress).toBe(0);
    expect(v.message).toBe("robots.txt blocks us");
    expect(isRunFinished(v)).toBe(true);
  });

  it("stops on a cancelled run", () => {
    const v = runViewFromRow(row({ status: "cancelled", phase: "fetch" }));
    expect(v.message).toBe("Scan cancelled");
    expect(isRunFinished(v)).toBe(true);
  });

  it("clamps the ratio and copies the counters", () => {
    const v = runViewFromRow(row({ phase: "fetch", pages_planned: 4, pages_fetched: 9, pages_failed: 1, text_bytes: 1200 }));
    expect(v.progress).toBeCloseTo(0.6, 3);
    expect(v.pagesFetched).toBe(9);
    expect(v.pagesFailed).toBe(1);
    expect(v.textBytes).toBe(1200);
    expect(v.log).toEqual([]);
  });
});

describe("pageLabelFromUrl", () => {
  it("names the home page and slugged pages", () => {
    expect(pageLabelFromUrl("https://example.com/")).toBe("the home page");
    expect(pageLabelFromUrl("https://example.com/pricing/")).toBe("the pricing page");
    expect(pageLabelFromUrl("https://example.com/about-us.html")).toBe("the about us page");
    expect(pageLabelFromUrl("https://example.com/blog/best_in-langley")).toBe("the best in langley page");
    expect(pageLabelFromUrl("not a url")).toBe("a page");
  });
});

describe("statusCounts and sectionCounts", () => {
  it("counts every status and the required gaps", () => {
    const c = statusCounts(spec, data);
    expect(c).toEqual({ found: 1, conflict: 1, missing: 2, userProvided: 0, requiredMissing: 2, total: 4 });
    expect(completion(c)).toBeCloseTo(0.25, 3);
  });

  it("counts user_provided as confirmed", () => {
    const edited: FactSheetData = {
      ...data,
      fields: { ...data.fields, phone: { value: "604-533-9163", status: "user_provided", evidence: [] } },
    };
    const c = statusCounts(spec, edited);
    expect(c.userProvided).toBe(1);
    expect(c.missing).toBe(1);
    expect(completion(c)).toBeCloseTo(0.5, 3);
  });

  it("orders sections by their order and counts their own fields", () => {
    const s = sectionCounts(spec, data);
    expect(s.map((x) => x.id)).toEqual(["basics", "offerings"]);
    expect(s[0].counts).toEqual({ found: 1, conflict: 0, missing: 2, userProvided: 0, requiredMissing: 1, total: 3 });
    expect(s[1].counts).toEqual({ found: 0, conflict: 1, missing: 0, userProvided: 0, requiredMissing: 1, total: 1 });
  });

  it("fills in fields the sheet lacks", () => {
    const fields = normalizeFields(spec, data);
    expect(Object.keys(fields)).toEqual(["company_name", "phone", "headquarters", "services"]);
    expect(fields.headquarters).toEqual({ value: null, status: "missing", evidence: [] });
  });
});

describe("formatValue", () => {
  const text = field({ id: "t", section: "basics", type: "text" });

  it("renders scalars as trimmed text", () => {
    expect(formatValue(text, "  Legiit ")).toBe("Legiit");
    expect(formatValue(field({ id: "u", section: "basics", type: "url" }), "https://legiit.com")).toBe("https://legiit.com");
    expect(formatValue(field({ id: "e", section: "basics", type: "email" }), "help@legiit.com")).toBe("help@legiit.com");
    expect(formatValue(field({ id: "p", section: "basics", type: "phone" }), "604-533-9163")).toBe("604-533-9163");
    expect(formatValue(field({ id: "l", section: "basics", type: "long_text" }), "One.\n\nTwo.")).toBe("One.\n\nTwo.");
    expect(formatValue(field({ id: "d", section: "basics", type: "date" }), "2018-02-07")).toBe("2018-02-07");
    expect(formatValue(text, null)).toBe("");
  });

  it("renders an address from its parts, or from its text", () => {
    const address = field({ id: "a", section: "basics", type: "address" });
    const parts = {
      streetAddress: "#315, 20385 64 Avenue",
      addressLocality: "Langley",
      addressRegion: "BC",
      postalCode: "V2Y 1N5",
      addressCountry: "CA",
      text: "ignored when parts exist",
    };
    expect(addressLines(parts)).toEqual(["#315, 20385 64 Avenue", "Langley, BC V2Y 1N5", "CA"]);
    expect(formatValue(address, parts)).toBe("#315, 20385 64 Avenue, Langley, BC V2Y 1N5, CA");
    expect(formatValue(address, { text: "Remote, registered in Delaware" })).toBe("Remote, registered in Delaware");
    expect(isEmptyValue({ text: "  " })).toBe(true);
  });

  it("tells a one-line address from one with parts", () => {
    const line = "#315, 20385 64 Avenue, Langley, BC V2Y 1N5";
    expect(isOneLineAddress({ text: line })).toBe(true);
    expect(isOneLineAddress({ text: line, postalCode: "V2Y 1N5" })).toBe(false);
    expect(isOneLineAddress({ postalCode: "V2Y 1N5" })).toBe(false);
    expect(isOneLineAddress({ text: "  " })).toBe(false);
    // Parts outside the field's keys do not count as parts of this field.
    expect(isOneLineAddress({ text: line, addressCountry: "CA" }, ["streetAddress", "postalCode"])).toBe(true);
  });

  it("builds the saved address from parts or from one line", () => {
    expect(
      addressFromParts({ streetAddress: " #315, 20385 64 Avenue ", addressLocality: "Langley", addressRegion: "BC", postalCode: "" }),
    ).toEqual({
      streetAddress: "#315, 20385 64 Avenue",
      addressLocality: "Langley",
      addressRegion: "BC",
      text: "#315, 20385 64 Avenue, Langley, BC",
    });
    expect(addressFromParts({ postalCode: "V2Y 1N5", addressCountry: "CA" }, ["postalCode"])).toEqual({
      postalCode: "V2Y 1N5",
      text: "V2Y 1N5",
    });
    expect(addressFromParts({ streetAddress: " " })).toEqual({});
    expect(addressFromLine("  Remote, registered in Delaware ")).toEqual({ text: "Remote, registered in Delaware" });
    expect(addressFromLine("   ")).toEqual({});
    expect(isEmptyValue(addressFromLine("   "))).toBe(true);
  });

  it("renders a list in item-shape order", () => {
    expect(
      formatValue(services, [
        { price: "$6", name: "SEO" },
        { name: "Content", price: "" },
      ]),
    ).toBe("SEO / $6; Content");
    expect(isEmptyValue([{ name: " " }])).toBe(true);
  });

  it("picks a table for short shapes and a stack for long ones", () => {
    expect(listLayout(services)).toBe("table");
    expect(listLayout(field({ id: "founders", section: "team", type: "list", itemShape: services.itemShape }))).toBe("stack");
    expect(
      listLayout(
        field({
          id: "faq",
          section: "faq",
          type: "list",
          itemShape: [
            { key: "q", label: "Q", type: "text" },
            { key: "a", label: "A", type: "long_text" },
          ],
        }),
      ),
    ).toBe("stack");
  });
});

describe("item conflicts", () => {
  const conflicts = [
    {
      key: "Individual counselling, 50 minutes",
      on: ["price"],
      candidates: [
        { value: [{ name: "Individual counselling, 50 minutes", price: "$170 Total" }], evidence: [] },
        { value: [{ name: "Individual counselling, 50 minutes", price: "$170 + GST" }], evidence: [] },
      ],
    },
  ];

  it("matches a conflict to its item on the dedupe key, case-insensitively", () => {
    expect(conflictForItem(services, { name: "individual counselling, 50 minutes", price: "$170" }, conflicts)).toBe(conflicts[0]);
    expect(conflictForItem(services, { name: "Couples", price: "$195" }, conflicts)).toBeUndefined();
    expect(conflictForItem(services, { name: "Couples" }, undefined)).toBeUndefined();
  });

  it("summarises a candidate by the keys that disagree", () => {
    expect(candidateItemSummary(services, conflicts[0].candidates[1].value, ["price"])).toBe("Price: $170 + GST");
    expect(candidateItemSummary(services, [{ name: "SEO" }], ["price"])).toBe("SEO");
  });
});

describe("sourceLabel", () => {
  const pages = [
    { id: "1", url: "https://www.legiit.com/about/", title: "About Legiit | Curated Freelance Marketplace" },
    { id: "2", url: "https://legiit.com/pricing", title: "" },
  ];

  it("uses the page title when the crawl has it", () => {
    expect(sourceLabel("https://legiit.com/about", pages)).toBe("About Legiit | Curated Freelance Marketplace");
  });

  it("falls back to host and path", () => {
    expect(sourceLabel("https://legiit.com/pricing", pages)).toBe("legiit.com/pricing");
    expect(sourceLabel("https://www.example.com/team/", [])).toBe("example.com/team");
    expect(sourceLabel("https://example.com/", [])).toBe("example.com");
  });

  it("names the user for empty urls", () => {
    expect(sourceLabel("", pages)).toBe("You");
  });

  it("keys urls without scheme, www, trailing slash, or hash", () => {
    expect(urlKey("https://www.Example.com/About/#team")).toBe("example.com/about");
    expect(hostPath("https://www.example.com/a%20b/")).toBe("example.com/a b");
  });
});

describe("undoForUserValue", () => {
  it("restores what the scan found when it found or contradicted something", () => {
    const found = { value: "604-533-9163", status: "found" as const, evidence: [] };
    expect(undoForUserValue({ status: "user_provided", crawled: found })).toBe("restore");
    expect(undoForUserValue({ status: "user_provided", crawled: { ...found, status: "conflict" } })).toBe("restore");
  });

  it("offers to clear an answer to a field the scan never found", () => {
    // applyUserEdit keeps this snapshot when a missing field is answered.
    const missing = { value: null, status: "missing" as const, evidence: [] };
    expect(undoForUserValue({ status: "user_provided", crawled: missing })).toBe("clear");
    expect(undoForUserValue({ status: "user_provided" })).toBe("clear");
  });

  it("offers nothing for values the person did not provide", () => {
    expect(undoForUserValue({ status: "found" })).toBeNull();
    expect(undoForUserValue({ status: "missing" })).toBeNull();
    expect(undoForUserValue({ status: "conflict", crawled: { value: null, status: "missing", evidence: [] } })).toBeNull();
  });
});

describe("fillCompany", () => {
  it("replaces the placeholder with the name or a generic phrase", () => {
    expect(fillCompany("Finish this: '[COMPANY] is a ___.'", "Legiit")).toBe("Finish this: 'Legiit is a ___.'");
    expect(fillCompany("What does [COMPANY] do?", null)).toBe("What does the business do?");
    expect(fillCompany("No placeholder", "Legiit")).toBe("No placeholder");
  });
});

describe("schemaGroups", () => {
  it("groups blocks by page and skips pages with none", () => {
    const groups = schemaGroups([
      { id: "1", url: "https://a.com/", title: "Home", jsonld: [{ data: { "@type": "Organization" }, raw: "{}", types: ["Organization"] }] },
      { id: "2", url: "https://a.com/about", title: "About", jsonld: [] },
      { id: "3", url: "https://a.com/faq", title: null, jsonld: null },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].url).toBe("https://a.com/");
    expect(groups[0].blocks[0].types).toEqual(["Organization"]);
  });
});
