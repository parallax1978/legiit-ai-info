import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import {
  DraftFaqSchema,
  DraftFullSchema,
  DraftMainSchema,
  draftFromFull,
  draftFromMain,
  draftToFullOutput,
  draftToMainOutput,
  draftWithFaq,
  type DraftFaqOutput,
  type DraftMainOutput,
} from "./schema";
import type { PageDraft } from "./types";

function mainOutput(): DraftMainOutput {
  return {
    metaTitle: "About Legiit | Curated freelance marketplace",
    metaDescription: "Legiit is a curated freelance marketplace for business owners and agencies.",
    title: "About Legiit",
    intro: ["Legiit is a curated freelance marketplace where business owners and agencies buy work from vetted freelancers."],
    offerings: [
      {
        heading: "The marketplace",
        paragraphs: ["Vetted freelancers sell productized services on Legiit. Orders start at $6."],
        links: [{ label: "The marketplace", url: "https://legiit.com" }],
      },
    ],
    differentiators: [
      {
        heading: "The freelancers are vetted",
        paragraphs: ["Legiit vets freelancers before they can sell.", '> "We don\'t even see them as the same thing."'],
        links: [],
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
    team: [{ heading: "Jessica Lavatai, COO", paragraphs: ["Jessica runs sales, community, and customer success."], links: [] }],
    teamSummary: ["Legiit is 45 people across six continents."],
    process: ["For buyers: create an account and search by service or category."],
    stillToFill: ["contract_terms"],
  };
}

function faqOutput(): DraftFaqOutput {
  return {
    faq: [
      { question: "Is Legiit the same thing as Fiverr or Upwork?", answer: "No. Fiverr and Upwork are built for volume." },
      { question: "How much does Legiit cost?", answer: "Creating an account is free. Orders start at $6." },
    ],
    closing: ["Legiit is for business owners who want the work done.", "Think Big."],
  };
}

/** A clean draft: what the conversions leave behind, so a round trip is an equality. */
function sampleDraft(): PageDraft {
  const main = mainOutput();
  const faq = faqOutput();
  return {
    metaTitle: main.metaTitle,
    metaDescription: main.metaDescription,
    title: main.title,
    intro: main.intro,
    offerings: [{ heading: "The marketplace", paragraphs: main.offerings[0].paragraphs, links: main.offerings[0].links }],
    differentiators: [{ heading: "The freelancers are vetted", paragraphs: main.differentiators[0].paragraphs }],
    customers: main.customers,
    founders: [{ heading: main.founders[0].heading, paragraphs: main.founders[0].paragraphs, links: main.founders[0].links }],
    originStory: main.originStory,
    team: [{ heading: "Jessica Lavatai, COO", paragraphs: main.team[0].paragraphs }],
    teamSummary: main.teamSummary,
    process: main.process,
    faq: faq.faq,
    closing: faq.closing,
    stillToFill: main.stillToFill,
  };
}

type JsonSchemaNode = {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaNode;
  $defs?: Record<string, JsonSchemaNode>;
  enum?: unknown[];
};

/** Every object node in a JSON schema, the $defs included. */
function objectNodes(node: JsonSchemaNode, out: JsonSchemaNode[] = []): JsonSchemaNode[] {
  if (node.type === "object") out.push(node);
  for (const child of Object.values(node.properties ?? {})) objectNodes(child, out);
  for (const child of Object.values(node.$defs ?? {})) objectNodes(child, out);
  if (node.items) objectNodes(node.items, out);
  return out;
}

describe("the output schemas", () => {
  it("are closed objects with every property required and no enums, down to the items", () => {
    for (const schema of [DraftMainSchema, DraftFaqSchema, DraftFullSchema]) {
      const json = zodOutputFormat(schema).schema as JsonSchemaNode;
      const nodes = objectNodes(json);
      expect(nodes.length).toBeGreaterThan(1);
      for (const node of nodes) {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required ?? [])].sort()).toEqual(Object.keys(node.properties ?? {}).sort());
      }
      expect(JSON.stringify(json)).not.toContain('"enum"');
    }
  });

  it("split the draft between main and faq, and full is their union", () => {
    const main = Object.keys(DraftMainSchema.shape);
    const faq = Object.keys(DraftFaqSchema.shape);
    const full = Object.keys(DraftFullSchema.shape);
    expect(main).toContain("stillToFill");
    expect(main).not.toContain("faq");
    expect(main).not.toContain("closing");
    expect(faq).toEqual(["faq", "closing"]);
    expect([...full].sort()).toEqual([...main, ...faq].sort());
  });

  it("parse a complete output and reject a missing property", () => {
    expect(DraftMainSchema.safeParse(mainOutput()).success).toBe(true);
    expect(DraftFaqSchema.safeParse(faqOutput()).success).toBe(true);
    expect(DraftFullSchema.safeParse({ ...mainOutput(), ...faqOutput() }).success).toBe(true);

    const { stillToFill, ...withoutIds } = mainOutput();
    void stillToFill;
    expect(DraftMainSchema.safeParse(withoutIds).success).toBe(false);
    expect(DraftFaqSchema.safeParse({ faq: [{ question: "Q", answer: "A" }] }).success).toBe(false);
    expect(DraftFullSchema.safeParse(mainOutput()).success).toBe(false);
  });
});

describe("draftFromMain", () => {
  it("trims everything and drops items without a heading, blank paragraphs, links without a URL, and repeated ids", () => {
    const draft = draftFromMain({
      ...mainOutput(),
      metaTitle: "  About Legiit  ",
      intro: ["  Legiit is a\n curated freelance   marketplace. ", "   "],
      offerings: [
        {
          heading: "  The marketplace ",
          paragraphs: [" One. ", ""],
          links: [
            { label: " ", url: " https://legiit.com " },
            { label: "Nowhere", url: "" },
          ],
        },
        { heading: "   ", paragraphs: ["Dropped with its heading."], links: [] },
      ],
      customers: [" Agencies ", ""],
      stillToFill: [" founded_date ", "founded_date", "", "headquarters"],
    });
    expect(draft.metaTitle).toBe("About Legiit");
    expect(draft.intro).toEqual(["Legiit is a curated freelance marketplace."]);
    expect(draft.offerings).toEqual([
      { heading: "The marketplace", paragraphs: ["One."], links: [{ label: "https://legiit.com", url: "https://legiit.com" }] },
    ]);
    expect(draft.customers).toEqual(["Agencies"]);
    expect(draft.stillToFill).toEqual(["founded_date", "headquarters"]);
    expect(draft.faq).toEqual([]);
    expect(draft.closing).toEqual([]);
  });

  it("leaves the links key out of an item with none", () => {
    const draft = draftFromMain({
      ...mainOutput(),
      team: [{ heading: " Jessica Lavatai, COO ", paragraphs: ["Runs sales."], links: [] }],
    });
    expect(draft.team).toEqual([{ heading: "Jessica Lavatai, COO", paragraphs: ["Runs sales."] }]);
    expect("links" in draft.team[0]).toBe(false);
  });

  it("keeps the quote marker on a quoted paragraph", () => {
    const draft = draftFromMain(mainOutput());
    expect(draft.differentiators[0].paragraphs[1]).toMatch(/^> "/);
  });
});

describe("draftWithFaq", () => {
  it("writes the FAQ and the closing onto the draft and drops incomplete pairs", () => {
    const main = draftFromMain(mainOutput());
    const draft = draftWithFaq(main, {
      faq: [
        { question: " Is Legiit the same as Fiverr? ", answer: " No. " },
        { question: "Empty", answer: "  " },
        { question: "", answer: "An answer with no question." },
      ],
      closing: [" Think Big. ", ""],
    });
    expect(draft.faq).toEqual([{ question: "Is Legiit the same as Fiverr?", answer: "No." }]);
    expect(draft.closing).toEqual(["Think Big."]);
    expect({ ...draft, faq: [], closing: [] }).toEqual(main);
    expect(main.faq).toEqual([]);
  });
});

describe("round trips", () => {
  it("a draft survives the full output shape and back", () => {
    const draft = sampleDraft();
    const out = draftToFullOutput(draft);
    expect(DraftFullSchema.safeParse(out).success).toBe(true);
    expect(out.differentiators[0].links).toEqual([]);
    expect(draftFromFull(out)).toEqual(draft);
  });

  it("main then faq equals full", () => {
    const main = mainOutput();
    const faq = faqOutput();
    expect(draftWithFaq(draftFromMain(main), faq)).toEqual(draftFromFull({ ...main, ...faq }));
    expect(draftFromFull({ ...main, ...faq })).toEqual(sampleDraft());
  });

  it("the main shape of a draft is the full shape without the FAQ and the closing", () => {
    const draft = sampleDraft();
    const main = draftToMainOutput(draft);
    expect(DraftMainSchema.safeParse(main).success).toBe(true);
    expect(Object.keys(main)).not.toContain("faq");
    expect(Object.keys(main)).not.toContain("closing");
    expect(draftToFullOutput(draft)).toMatchObject(main);
  });

  it("does not share arrays with the draft it was made from", () => {
    const draft = sampleDraft();
    const out = draftToFullOutput(draft);
    out.intro.push("Added.");
    out.offerings[0].links.push({ label: "x", url: "https://x.example" });
    expect(draft.intro).toHaveLength(1);
    expect(draft.offerings[0].links).toHaveLength(1);
  });
});
