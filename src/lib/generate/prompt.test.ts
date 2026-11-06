import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FactField, FactSheetData } from "@/lib/facts/types";
import { ABOUT_V1 } from "@/templates/about-v1";
import { BANNED } from "./lint";
import {
  buildFactSheetBlock,
  buildRewritePrompt,
  buildWriterSystemPrompt,
  buildWriterUserPrompt,
  promptQuotes,
  QUOTE_CHARS,
  WRITING_RULES,
} from "./prompt";
import { draftToFullOutput } from "./schema";
import type { LintReport, PageDraft } from "./types";

function loadFixture(): FactSheetData {
  const file = path.join(process.cwd(), "examples", "fixtures", "legiit.factsheet.json");
  return JSON.parse(readFileSync(file, "utf8")) as FactSheetData;
}

/** A deep copy with some fields replaced, so a test can change the sheet without touching the others. */
function withFields(data: FactSheetData, fields: Record<string, FactField>): FactSheetData {
  const copy = JSON.parse(JSON.stringify(data)) as FactSheetData;
  Object.assign(copy.fields, fields);
  return copy;
}

type FactJson = Record<string, { value: unknown; quotes?: string[] }>;

/** The fact sheet JSON block of a prompt, parsed. It is the first block that opens with "{" on its own line. */
function factJson(prompt: string): FactJson {
  const start = prompt.indexOf("\n{\n");
  const end = prompt.indexOf("\n}\n", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return JSON.parse(prompt.slice(start + 1, end + 2)) as FactJson;
}

function lineStarting(prompt: string, prefix: string): string {
  const line = prompt.split("\n").find((l) => l.startsWith(prefix));
  expect(line, `no line starts with "${prefix}"`).toBeDefined();
  return line ?? "";
}

function sampleDraft(): PageDraft {
  return {
    metaTitle: "About Legiit | Curated freelance marketplace",
    metaDescription: "Legiit is a curated freelance marketplace for business owners and agencies.",
    title: "About Legiit",
    intro: ["Legiit is a curated freelance marketplace where business owners and agencies buy work from vetted freelancers."],
    offerings: [
      {
        heading: "The marketplace",
        paragraphs: ["Vetted freelancers sell productized services on Legiit."],
        links: [{ label: "The marketplace", url: "https://legiit.com" }],
      },
    ],
    differentiators: [
      {
        heading: "The freelancers are vetted",
        paragraphs: ["Legiit vets freelancers before they can sell.", '> "We don\'t even see them as the same thing."'],
      },
    ],
    customers: ["Business owners priced out of an agency retainer."],
    founders: [
      {
        heading: "Chris M. Walker, Founder and CEO",
        paragraphs: ["Chris grew up in North Myrtle Beach, South Carolina."],
        links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/superstarseo/" }],
      },
    ],
    originStory: ["Legiit launched on February 7, 2018."],
    team: [{ heading: "Jessica Lavatai, COO", paragraphs: ["Jessica runs sales, community, and customer success."] }],
    teamSummary: ["Legiit is 45 people across six continents."],
    process: ["For buyers: create an account and search by service or category."],
    faq: [],
    closing: [],
    stillToFill: [],
  };
}

const data = loadFixture();
const base = { spec: ABOUT_V1, data, siteUrl: "https://legiit.com", companyName: "Legiit" };

describe("WRITING_RULES", () => {
  it("carries every rule from the spec and the whole banned list", () => {
    for (const word of BANNED) expect(WRITING_RULES).toContain(word);
    for (const rule of [
      "Plain words",
      "Open on the point",
      "Third person, by name",
      "No em dashes or en dashes",
      "No buzzwords",
      "No exclamation marks",
      "No rhetorical questions",
      "Sentences under about 30 words",
      "Every number in the page",
      "No placeholders",
      "FAQ: 10 to 12 questions; answers of 2 to 3 sentences",
      "No empty section when the facts exist",
    ]) {
      expect(WRITING_RULES).toContain(rule);
    }
    // The rules follow their own rule on dashes.
    expect(WRITING_RULES).not.toMatch(/[–—]/);
  });
});

describe("buildWriterSystemPrompt", () => {
  const system = buildWriterSystemPrompt(ABOUT_V1);

  it("opens with the role, then the rules in full, then the section plan", () => {
    expect(system.split("\n")[0]).toBe(
      'You write the "About page (eight sections)" for a business website from its fact sheet, as JSON for a program that renders the page and its schema.',
    );
    expect(system).toContain(WRITING_RULES);
    expect(system.indexOf(WRITING_RULES)).toBeLessThan(system.indexOf('"What [COMPANY] does"'));
    for (const section of ABOUT_V1.sections) {
      if (section.heading) expect(system).toContain(`"${section.heading}" (${section.id})`);
    }
    const order = ABOUT_V1.sections
      .filter((s) => s.heading)
      .sort((a, b) => a.order - b.order)
      .map((s) => system.indexOf(`"${s.heading}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("names the page fields by id and label and leaves schema-only fields out", () => {
    expect(system).toContain("services (Services, products, and features)");
    expect(system).toContain("founder_quote (A quote from the founder)");
    expect(system).toContain("existing_faqs (Questions already answered on the site)");
    expect(system).not.toContain("logo_url");
    expect(system).not.toContain("business_type");
  });

  it("carries the rules per section", () => {
    expect(system).toContain("one item per services entry");
    expect(system).toContain("about five items");
    expect(system).toContain('"> " followed by the quote word for word');
    expect(system).toContain("renders them as a bullet list");
    expect(system).toContain('"Name, Title"');
    expect(system).toContain('"How [COMPANY] started"');
    expect(system).toContain("10 to 12 questions, each answered in 2 to 3 sentences");
    expect(system).toContain("Take existing_faqs first");
    expect(system).toContain("Do not write it");
    expect(system).toContain("A required field with no value goes in stillToFill, and nothing is written around it");
  });

  it("is the same bytes every call, so the prompt cache applies", () => {
    expect(buildWriterSystemPrompt(ABOUT_V1)).toBe(system);
    expect(system).not.toContain("Legiit is a curated");
  });
});

describe("buildWriterUserPrompt, main", () => {
  const prompt = buildWriterUserPrompt({ ...base, part: "main" });
  const facts = factJson(prompt);

  it("names the task, the company, and the site", () => {
    expect(prompt.split("\n")[0]).toBe(
      "Write the main sections of the About page for Legiit: everything except the FAQ and the closing.",
    );
    expect(prompt).toContain("Company name ([COMPANY] in the rules): Legiit");
    expect(prompt).toContain("Site: https://legiit.com");
  });

  it("carries the found and owner-provided fields with their values and quotes", () => {
    expect(facts.category).toEqual({
      value: "curated freelance marketplace",
      quotes: [expect.stringContaining("Legiit is a curated freelance marketplace")],
    });
    expect(facts.founded_date).toEqual({
      value: "2018-02-07",
      quotes: [
        "It launched on February 7, 2018 and has processed over one million orders since.",
        "Legiit launched on February 7, 2018.",
      ],
    });
    expect(facts.mission.value).toBe("The goal is for every business owner on earth to use it.");
    // Owner-provided fields come along with the owner's note as the quote.
    expect(facts.headquarters).toEqual({
      value: {
        streetAddress: "2411 N. Oak Street 105E",
        addressLocality: "Myrtle Beach",
        addressRegion: "SC",
        postalCode: "29577",
        addressCountry: "US",
        text: "2411 N. Oak Street 105E, Myrtle Beach, SC 29577, USA",
      },
      quotes: ["Not Las Vegas. 2411 N. Oak Street 105E, Myrtle Beach, SC 29577, USA"],
    });
  });

  it("carries list items with every key that has a value", () => {
    expect(facts.pricing.value).toContainEqual({
      name: "Legiit Leads Agency Empire",
      price: "$497 a month",
      notes: expect.stringContaining("500 searches"),
    });
    expect(facts.services.value).toContainEqual({
      name: "Command Center",
      description: expect.stringContaining("business operating system"),
    });
    const founders = facts.founders.value as Record<string, string>[];
    expect(founders[0]).toMatchObject({
      name: "Chris M. Walker",
      title: "Founder and CEO",
      bio: expect.stringContaining("North Myrtle Beach"),
      linkedin: "https://www.linkedin.com/in/superstarseo/",
      youtube: "https://www.youtube.com/@ChrisMWalker",
    });
    expect(founders[0]).not.toHaveProperty("credentials");
    expect(founders[1]).toEqual({
      name: "Jim Sabellico",
      title: "Co-founder and CTO",
      bio: expect.stringContaining("co-founded Legiit"),
      linkedin: "https://www.linkedin.com/in/jimsabellico/",
    });
    expect(facts.existing_faqs.value).toContainEqual({
      question: "Who is behind Legiit?",
      answer: expect.stringContaining("Chris M. Walker founded Legiit"),
      url: "https://legiit.com/about",
    });
  });

  it("keeps missing fields, schema-only fields, and conflict candidates out of the JSON", () => {
    for (const key of Object.keys(facts)) {
      expect(["found", "user_provided"]).toContain(data.fields[key].status);
      expect(ABOUT_V1.fields.find((f) => f.id === key)?.rendersIn).toContain("page");
    }
    expect(facts).not.toHaveProperty("legal_name");
    expect(facts).not.toHaveProperty("phone");
    expect(facts).not.toHaveProperty("logo_url");
    expect(facts).not.toHaveProperty("business_type");
    // The founders item conflict (a JSON-LD node that calls Jim "Jim") stays out.
    expect(prompt).not.toContain('\\"name\\": \\"Jim\\"');
    expect(prompt).not.toContain("itemConflicts");
    expect(prompt).not.toContain("candidates");
    expect(prompt).not.toContain("crawled");
  });

  it("names the missing fields by label and says there is nothing in conflict", () => {
    const missing = lineStarting(prompt, "Fields with no value (unknown; do not invent): ");
    for (const label of ["Legal name", "Years in business", "Phone", "Email", "Opening hours", "Awards and recognition"]) {
      expect(missing).toContain(label);
    }
    expect(missing).not.toContain("Logo image");
    expect(missing).not.toContain("required");
    expect(prompt).toContain("Fields in conflict (the owner has not resolved this; do not use it): none");
    expect(prompt).toContain("stillToFill: none (an empty array)");
  });

  it("does not carry the draft or the FAQ list", () => {
    expect(prompt).not.toContain("The draft so far");
    expect(prompt).not.toContain("Questions already answered on the site");
  });
});

describe("buildWriterUserPrompt with conflicts and gaps", () => {
  const edited = withFields(data, {
    phone: {
      value: "(937) 555-0142",
      status: "conflict",
      evidence: [{ quote: "Call (937) 555-0142", url: "https://legiit.com", source: "page" }],
      candidates: [
        { value: "(937) 555-0142", evidence: [{ quote: "Call (937) 555-0142", url: "https://legiit.com", source: "page" }] },
        {
          value: "(937) 555-0199",
          evidence: [{ quote: "Call us at (937) 555-0199", url: "https://legiit.com/contact", source: "page" }],
        },
      ],
    },
    founded_date: {
      ...data.fields.founded_date,
      status: "conflict",
      candidates: [
        { value: "2018-02-07", evidence: data.fields.founded_date.evidence },
        { value: "2016", evidence: [{ quote: "in business since 2016", url: "https://legiit.com", source: "page" }] },
      ],
    },
    contract_terms: { value: null, status: "missing", evidence: [] },
  });
  const prompt = buildWriterUserPrompt({ ...base, data: edited, part: "main" });
  const facts = factJson(prompt);

  it("names conflict fields by label, marks required ones, and keeps every candidate out", () => {
    expect(lineStarting(prompt, "Fields in conflict")).toBe(
      "Fields in conflict (the owner has not resolved this; do not use it): Founded (required; id founded_date); Phone",
    );
    expect(prompt).not.toContain("555-0142");
    expect(prompt).not.toContain("555-0199");
    expect(prompt).not.toContain("since 2016");
    expect(prompt).not.toContain("2018-02-07");
    expect(facts).not.toHaveProperty("phone");
    expect(facts).not.toHaveProperty("founded_date");
  });

  it("marks required gaps and lists the ids that go in stillToFill", () => {
    expect(lineStarting(prompt, "Fields with no value")).toContain("Contract terms (required; id contract_terms)");
    expect(prompt).toContain("stillToFill: founded_date, contract_terms");
    expect(facts).not.toHaveProperty("contract_terms");
  });

  it("treats a found field with nothing in it as missing", () => {
    const empty = withFields(data, {
      awards: { value: [], status: "found", evidence: [] },
      mission: { value: "   ", status: "user_provided", evidence: [] },
    });
    const p = buildWriterUserPrompt({ ...base, data: empty, part: "main" });
    const missing = lineStarting(p, "Fields with no value");
    expect(missing).toContain("Awards and recognition");
    expect(missing).toContain("Mission or goal");
    expect(factJson(p)).not.toHaveProperty("mission");
  });
});

describe("promptQuotes", () => {
  it("keeps at most two distinct quotes, page and owner quotes first, each cut to 300 characters", () => {
    const long = "x".repeat(QUOTE_CHARS + 50);
    const quotes = promptQuotes([
      { quote: "https://example.com/logo.png", url: "", source: "image" },
      { quote: long, url: "", source: "page" },
      { quote: "  Call   us  ", url: "", source: "user" },
      { quote: "Call us", url: "", source: "page" },
      { quote: "", url: "", source: "page" },
    ]);
    expect(quotes).toEqual([long.slice(0, QUOTE_CHARS), "Call us"]);
    expect(quotes[0]).toHaveLength(QUOTE_CHARS);
  });

  it("falls back to markup quotes when there is nothing else", () => {
    expect(promptQuotes([{ quote: "https://example.com/logo.png", url: "", source: "image" }])).toEqual([
      "https://example.com/logo.png",
    ]);
    expect(promptQuotes([])).toEqual([]);
  });
});

describe("buildFactSheetBlock", () => {
  it("skips named fields and can leave the stillToFill line out", () => {
    const lines = buildFactSheetBlock(ABOUT_V1, data, { skip: ["existing_faqs"], stillToFill: false });
    const text = lines.join("\n");
    expect(text).not.toContain('"existing_faqs"');
    expect(text).toContain('"company_name": {"value":"Legiit"');
    expect(text).not.toContain("stillToFill");
    expect(JSON.parse(text.slice(text.indexOf("{\n"), text.indexOf("\n}") + 2))).toHaveProperty("services");
  });
});

describe("buildWriterUserPrompt, faq", () => {
  const draft = sampleDraft();
  const prompt = buildWriterUserPrompt({ ...base, part: "faq", draft });

  it("names the task and carries the facts, the draft so far, and the existing FAQs as a list", () => {
    expect(prompt.split("\n")[0]).toBe("Write the FAQ and the closing lines of the About page for Legiit.");
    expect(prompt).toContain("Company name ([COMPANY] in the rules): Legiit");
    expect(prompt).toContain("The draft so far");
    expect(prompt).toContain(draft.intro[0]);
    expect(prompt).toContain('"heading": "The marketplace"');
    expect(prompt).toContain('> \\"We don\'t even see them as the same thing.\\"');
    expect(prompt).toContain("Questions already answered on the site (existing_faqs), to use first:");
    expect(prompt).toContain("1. Q: Is Legiit the same thing as Fiverr or Upwork?");
    expect(prompt).toContain("   A: No. Fiverr and Upwork are horizontal marketplaces built for volume.");
    expect(prompt).toContain("10. Q: Who is behind Legiit?");
    // The list stands in for the field in the JSON; the rest of the facts are still there.
    const facts = factJson(prompt);
    expect(facts).not.toHaveProperty("existing_faqs");
    expect(facts.category.value).toBe("curated freelance marketplace");
    expect(facts.founded_date.value).toBe("2018-02-07");
  });

  it("shows the draft without a faq or closing and keeps its stillToFill", () => {
    const start = prompt.indexOf('{\n "metaTitle"');
    const end = prompt.indexOf("\n}\n", start);
    const json = JSON.parse(prompt.slice(start, end + 2)) as Record<string, unknown>;
    expect(json).not.toHaveProperty("faq");
    expect(json).not.toHaveProperty("closing");
    expect(json.stillToFill).toEqual([]);
    expect(json.title).toBe("About Legiit");
  });

  it("needs the draft", () => {
    expect(() => buildWriterUserPrompt({ ...base, part: "faq" })).toThrow(/draft/);
  });

  it("says so when the site has no FAQs", () => {
    const none = withFields(data, { existing_faqs: { value: null, status: "missing", evidence: [] } });
    const p = buildWriterUserPrompt({ ...base, data: none, part: "faq", draft });
    expect(p).toContain("(none on the site: write every question from the page's facts)");
  });
});

describe("buildRewritePrompt", () => {
  const draft = sampleDraft();
  const report: LintReport = {
    passed: false,
    attempts: 0,
    issues: [
      { where: "intro[0]", kind: "banned_word", text: "seamless", hint: "Replace the word with a plain one or cut it." },
      {
        where: "offerings[0].paragraphs[0]",
        kind: "invented_number",
        text: "500",
        hint: "Use a number from the fact sheet or cut it.",
      },
    ],
  };
  const prompt = buildRewritePrompt({ spec: ABOUT_V1, data, draft, report });

  it("says to change only the flagged text and carries every issue", () => {
    expect(prompt.split("\n")[0]).toBe(
      "Rewrite the flagged text in this About page draft for Legiit and return the whole draft.",
    );
    expect(prompt).toContain("keep everything else word for word");
    expect(prompt).toContain("Issues (2)");
    expect(prompt).toContain('- intro[0] (banned_word): "seamless". Replace the word with a plain one or cut it.');
    expect(prompt).toContain(
      '- offerings[0].paragraphs[0] (invented_number): "500". Use a number from the fact sheet or cut it.',
    );
  });

  it("carries the draft in the output shape and the facts, without a stillToFill instruction", () => {
    const start = prompt.indexOf('{\n "metaTitle"');
    const end = prompt.indexOf("\n}\n", start);
    expect(JSON.parse(prompt.slice(start, end + 2))).toEqual(draftToFullOutput(draft));
    expect(prompt).toContain('"founded_date": {"value":"2018-02-07"');
    expect(prompt).toContain("Fields in conflict (the owner has not resolved this; do not use it): none");
    expect(prompt).not.toContain("\nstillToFill:");
  });

  it("takes the company name from the fact sheet, then the title", () => {
    const noName = withFields(data, { company_name: { value: null, status: "missing", evidence: [] } });
    const p = buildRewritePrompt({ spec: ABOUT_V1, data: noName, draft, report });
    expect(p.split("\n")[0]).toContain("for Legiit and return");
  });
});
