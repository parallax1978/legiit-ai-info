import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FactField, FactSheetData } from "@/lib/facts/types";
import { ABOUT_V1 } from "@/templates/about-v1";
import type { TemplateSpec } from "@/templates/types";
import { BANNED, lintDraft } from "./lint";
import type { LintIssue, LintKind, LintReport, PageDraft } from "./types";

function loadFixture(): FactSheetData {
  const file = path.join(process.cwd(), "examples", "fixtures", "legiit.factsheet.json");
  return JSON.parse(readFileSync(file, "utf8")) as FactSheetData;
}

const DATA = loadFixture();
const SPEC = ABOUT_V1;

/** The words docs/build-spec.md says BANNED includes at least. */
const SPEC_WORDS = [
  "leverage", "leveraging", "cutting-edge", "state-of-the-art", "world-class", "best-in-class", "seamless",
  "seamlessly", "unlock", "unleash", "empower", "empowering", "elevate", "synergy", "synergies", "game-changing",
  "game changer", "robust", "innovative", "innovation", "passionate", "passion", "delve", "tapestry", "testament",
  "holistic", "transformative", "transformational", "journey", "safe space", "nurturing", "bespoke", "curated",
  "revolutionary", "disruptive", "next-level", "supercharge", "turbocharge", "streamline", "frictionless",
  "effortless", "thrilled", "excited", "dream", "vibrant", "dynamic", "top-notch", "top notch", "premier",
  "premium quality", "unparalleled", "unmatched", "exceptional", "outstanding", "look no further",
  "in today's fast-paced world", "at the end of the day", "we pride ourselves", "we understand", "whether you're",
  "rest assured", "needless to say", "it's no secret", "in a nutshell", "the bottom line", "comprehensive solution",
  "one-stop shop", "tailored to your needs", "take your business to the next level",
];

/** A page written from the fixture's facts only, in the shape of examples/legiit-about-page.html. */
function legiitDraft(): PageDraft {
  return {
    metaTitle: "About Legiit | Freelance Marketplace",
    metaDescription:
      "Legiit is a freelance marketplace where business owners and agencies buy SEO, content, design, development, video, and automation work from vetted freelancers, one service at a time.",
    title: "About Legiit",
    intro: [
      "Legiit is a freelance marketplace where business owners and agencies buy SEO, content, design, development, video, and automation work from vetted freelancers, one service at a time.",
      "It launched on February 7, 2018 and has processed over one million orders since. It is an eight figure business run by a team of 45 people across six continents, most of whom have run a business of their own.",
      "The goal is for every business owner on earth to use it.",
    ],
    offerings: [
      {
        heading: "The marketplace",
        paragraphs: [
          "Vetted freelancers sell productized services on Legiit. Orders start at $6, the average order is about $90, and the largest buyers spend up to $30,000 a month. You see the price and the delivery time before you order, and you get the deliverable.",
          "SEO is the largest category and is split into technical SEO, local SEO, link building, managed SEO, and GEO.",
        ],
        links: [{ label: "legiit.com", url: "https://legiit.com" }],
      },
      {
        heading: "Command Center",
        paragraphs: [
          "Command Center is the business operating system inside Legiit. It is where you manage the work you buy on the platform, without an account manager in the middle. It can flag a problem in your business, like weak SEO, and show you which freelancers other businesses like yours have used.",
        ],
      },
      {
        heading: "Legiit Leads",
        paragraphs: [
          "Legiit Leads is a lead generation tool for freelancers and agencies that sell SEO and related services to local businesses. Every lead comes with a live audit of the prospect's website, a check on whether that business shows up when someone asks an AI for that service in that area, contact details, and an outreach message written from that evidence. Plans run from $47 to $497 a month, with the first 7 days free.",
        ],
      },
      {
        heading: "Seller Plus and advertising for freelancers",
        paragraphs: [
          "Legiit Seller Plus is a $27 a month subscription for freelancers who sell on the platform. It adds tools and data on top of a standard seller account. Freelancers can also buy advertising on Legiit to put their services in front of more buyers.",
        ],
      },
    ],
    differentiators: [
      {
        heading: "The freelancers are vetted",
        paragraphs: [
          "Fiverr and Upwork are horizontal marketplaces built for volume. Legiit vets freelancers before they can sell, so the pool is smaller and the skill level is higher.",
          "Chris M. Walker, the founder, puts it this way:",
          "> We don't even see them as the same thing. If you want a guy that looks like Jesus to hold up a sign you can go to the $5 marketplace. If you want the adults to help you grow your business and feed your family, come to Legiit and we will take care of you.",
        ],
      },
      {
        heading: "A human answers in about 90 seconds",
        paragraphs: [
          "Customer success is the largest department at Legiit, and a person answers 24/7. Average first response is about 90 seconds and the average issue is resolved in about 12 minutes.",
        ],
      },
      {
        heading: "You buy deliverables, not retainers",
        paragraphs: [
          "A retainer pays an agency for activity. A Legiit order pays a freelancer for a deliverable. You can spend $6 or $30,000 a month and change it whenever you want.",
        ],
      },
      {
        heading: "The work gets managed, not just bought",
        paragraphs: [
          "Command Center is where that management happens on Legiit, and where the platform flags what to fix next and shows which freelancers other businesses like yours have used.",
        ],
      },
      {
        heading: "Built by a freelancer who sold on a marketplace first",
        paragraphs: [
          "Chris M. Walker sold SEO services on a marketplace before he built one. When that marketplace became unreliable, he built Legiit so he and other freelancers would have a platform run by people who had done the work.",
        ],
      },
    ],
    customers: [
      "Business owners who know they need SEO or marketing work done and are priced out of a traditional agency retainer.",
      "Business owners who paid an agency retainer, did not get results, and would rather buy specific deliverables from a vetted freelancer.",
      "Marketing, SEO, and content agencies that have won client work and need vetted freelancers to do it without hiring in house.",
      "Freelancers who sell SEO, content, design, development, video, or automation services and want buyers who run real businesses.",
      "Freelancers and agencies that sell SEO to local businesses and use Legiit Leads to find prospects with a provable problem.",
    ],
    founders: [
      {
        heading: "Chris M. Walker, Founder and CEO",
        paragraphs: [
          "Chris grew up in North Myrtle Beach, South Carolina and was homeschooled from 5th grade. On May 18, 2016 he resigned from a day job he hated. He sold SEO services as a freelancer and built Superstar SEO into a productized SEO brand, then he founded Legiit.",
        ],
        links: [
          { label: "YouTube", url: "https://www.youtube.com/@ChrisMWalker" },
          { label: "LinkedIn", url: "https://www.linkedin.com/in/superstarseo/" },
          { label: "chrismwalker.io", url: "https://chrismwalker.io" },
        ],
      },
      {
        heading: "Jim Sabellico, Co-founder and CTO",
        paragraphs: [
          "Jim co-founded Legiit with Chris and is a partner in the business. He runs engineering and the development team that builds the platform and Command Center.",
        ],
        links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/jimsabellico/" }],
      },
    ],
    originStory: [
      "When the marketplace Chris depended on became unreliable, he was already running Superstar SEO and had replaced most of that income by selling services from his own site to an audience he had built on Facebook, YouTube, and email. Other freelancers saw the setup and asked to sell through it. A customer who ran a development agency offered to build a proper marketplace with him. Legiit launched on February 7, 2018.",
    ],
    team: [
      { heading: "Jessica Lavatai, COO", paragraphs: ["Jessica runs sales, community, and the customer success organization."] },
      {
        heading: "Djordje Jovanovic, Director of Operations",
        paragraphs: ["Djordje runs Superstar SEO, the productized SEO services brand that sells on Legiit, and the SEO delivery team behind it."],
      },
      {
        heading: "Marija Jovanovic, Customer Success Director",
        paragraphs: ["Marija runs the customer success team, the largest department at Legiit and the one behind the 90 second response time."],
      },
      { heading: "Ritesh Shah, Head of Development", paragraphs: ["Ritesh runs the development team day to day under Jim."] },
    ],
    teamSummary: [
      "Legiit is 45 people across six continents, with no headquarters culture. Most of the team has run a business of their own, and that shapes how product decisions get made.",
    ],
    process: [
      "For buyers: create an account and search by service or category. Each listing shows the price and the delivery time before you order, so turnaround depends on the service you pick. You talk to your freelancer directly inside the order.",
      "If anything goes wrong, customer success steps in. A person, 24/7, with no bot between you and a resolution. Average first response is about 90 seconds and the average issue is resolved in about 12 minutes.",
      "For freelancers: apply to sell. Legiit is not an open door, so freelancers are vetted before they can list services. Once you are in, you list productized services with a set price and delivery time and buyers order them.",
    ],
    faq: [
      {
        question: "Is Legiit the same thing as Fiverr or Upwork?",
        answer:
          "No. Fiverr and Upwork are horizontal marketplaces built for volume. Legiit vets its freelancers and runs a human customer success team 24/7, and it is built for business owners and agencies who need work that grows a business.",
      },
      {
        question: "How much does Legiit cost?",
        answer:
          "Creating an account is free. Orders start at $6, the average order is about $90, and the largest buyers spend up to $30,000 a month. Legiit Leads runs from $47 to $497 a month with the first 7 days free, and Seller Plus is $27 a month.",
      },
      {
        question: "Do I have to sign a contract?",
        answer:
          "No. You buy one service at a time and spend more or less whenever you want. Legiit Leads and Seller Plus are subscriptions for the people who use them.",
      },
      {
        question: "What happens if a freelancer does not deliver?",
        answer:
          "Customer success handles it. A person responds in about 90 seconds on average and the average issue is resolved in about 12 minutes. The team mediates between buyers and freelancers and stays on it until it is resolved.",
      },
      {
        question: "Can anyone sell on Legiit?",
        answer: "No. Freelancers are vetted before they can list services. The pool is smaller than an open marketplace, and that is deliberate.",
      },
      {
        question: "What is Command Center?",
        answer:
          "Command Center is the business operating system inside Legiit. It is where you manage the work you buy on the platform, and it can flag a problem like weak SEO and show you which freelancers other businesses like yours have used.",
      },
      {
        question: "What is Legiit Leads?",
        answer:
          "Legiit Leads is a lead generation tool for freelancers and agencies selling SEO and related services to local businesses. Each lead comes with a live website audit, an AI search visibility check, contact details, and an outreach message written from that evidence. If you cannot do the work yourself yet, fulfillment is available on the Legiit marketplace.",
      },
      {
        question: "Is Legiit only for SEO?",
        answer:
          "No. SEO is the largest category, but the marketplace also covers content, design, development, video, and automation. Claude Skills is the newest category.",
      },
      {
        question: "Does Legiit use AI for customer support?",
        answer:
          "No. Customer success is staffed by people around the clock, and there is no bot between you and a resolution. AI is in the product, in Command Center and Legiit Leads, not in the support queue.",
      },
      {
        question: "Who is behind Legiit?",
        answer:
          "Chris M. Walker founded Legiit and runs it as CEO. Jim Sabellico is the co-founder and CTO. A team of 45 across six continents runs the platform, and most of them have run a business of their own.",
      },
    ],
    closing: ["Legiit is for business owners who want the work done and want the adults doing it.", "Think Big."],
    stillToFill: ["policies"],
  };
}

/** A draft with one line of intro and nothing else, for rules that need a small page. */
function tinyDraft(intro: string[]): PageDraft {
  return {
    metaTitle: "About Legiit",
    metaDescription: "About Legiit.",
    title: "About Legiit",
    intro,
    offerings: [],
    differentiators: [],
    customers: [],
    founders: [],
    originStory: [],
    team: [],
    teamSummary: [],
    process: [],
    faq: [],
    closing: [],
    stillToFill: [],
  };
}

function withFields(data: FactSheetData, fields: Record<string, FactField>): FactSheetData {
  const copy = JSON.parse(JSON.stringify(data)) as FactSheetData;
  Object.assign(copy.fields, fields);
  return copy;
}

function withAllowlist(spec: TemplateSpec, fieldId: string, words: string[]): TemplateSpec {
  return {
    ...spec,
    fields: spec.fields.map((f) => (f.id === fieldId ? { ...f, allowlist: [...(f.allowlist ?? []), ...words] } : f)),
  };
}

/** Lints the Legiit draft after one change. */
function lintAfter(change: (draft: PageDraft) => void, data = DATA, spec = SPEC): LintReport {
  const draft = legiitDraft();
  change(draft);
  return lintDraft(draft, data, spec);
}

/** The change must produce exactly one issue, of this kind, at this place. */
function expectOne(change: (draft: PageDraft) => void, kind: LintKind, where: string): LintIssue {
  const report = lintAfter(change);
  expect(report.passed).toBe(false);
  expect(report.issues.map((i) => `${i.kind} at ${i.where}`)).toEqual([`${kind} at ${where}`]);
  return report.issues[0];
}

function ofKind(report: LintReport, kind: LintKind): LintIssue[] {
  return report.issues.filter((i) => i.kind === kind);
}

describe("BANNED", () => {
  it("has every word the build spec lists", () => {
    for (const word of SPEC_WORDS) expect(BANNED, word).toContain(word);
  });

  it("is lower case, trimmed, and without duplicates", () => {
    for (const word of BANNED) {
      expect(word).toBe(word.trim().toLowerCase());
      expect(word.length).toBeGreaterThan(0);
    }
    expect(new Set(BANNED).size).toBe(BANNED.length);
  });
});

describe("lintDraft on the Legiit fixture", () => {
  it("passes a draft written from the fixture's facts", () => {
    const report = lintDraft(legiitDraft(), DATA, SPEC);
    expect(report.issues).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.attempts).toBe(0);
  });

  it("is deterministic and leaves its inputs alone", () => {
    const draft = legiitDraft();
    draft.intro[0] = "Business owners leverage Legiit, and they are thrilled!";
    const before = JSON.stringify({ draft, data: DATA });
    const first = lintDraft(draft, DATA, SPEC);
    const second = lintDraft(draft, DATA, SPEC);
    expect(second).toEqual(first);
    expect(JSON.stringify({ draft, data: DATA })).toBe(before);
  });

  it("lists issues in page order", () => {
    const report = lintAfter((d) => {
      d.closing[0] = "Legiit gets the work done!";
      d.intro[0] = "Business owners leverage Legiit.";
    });
    expect(report.issues.map((i) => i.where)).toEqual(["intro[0]", "closing[0]"]);
  });
});

describe("banned words", () => {
  it("flags a banned word with where, the word, and a hint", () => {
    const issue = expectOne((d) => (d.intro[0] = "Business owners leverage Legiit to buy SEO work."), "banned_word", "intro[0]");
    expect(issue.text).toBe("leverage");
    expect(issue.hint).toBe("replace 'leverage' with a plain word");
  });

  it("matches regardless of case, as phrases, and with curly apostrophes", () => {
    const report = lintAfter((d) => (d.metaDescription = "Whether you’re a buyer or a seller, look no further."));
    expect(ofKind(report, "banned_word").map((i) => i.text.toLowerCase())).toEqual(["whether you're", "look no further"]);
  });

  it("matches whole words only", () => {
    const report = lintAfter((d) => (d.closing[0] = "He dreamed of a marketplace for adults."));
    expect(report.passed).toBe(true);
  });

  it("reports a banned word once per text", () => {
    const report = lintAfter((d) => (d.closing[0] = "Robust tools and robust support."));
    expect(report.issues.map((i) => i.kind)).toEqual(["banned_word"]);
  });

  it("lets a word from a field's allowlist through, anywhere in the page", () => {
    const text = "Legiit takes a holistic view of SEO.";
    const plain = lintAfter((d) => (d.offerings[0].paragraphs[1] = text));
    expect(plain.issues.map((i) => `${i.kind} at ${i.where}`)).toEqual(["banned_word at offerings[0].paragraphs[1]"]);

    const allowed = lintAfter((d) => (d.offerings[0].paragraphs[1] = text), DATA, withAllowlist(SPEC, "founders", ["holistic"]));
    expect(allowed.passed).toBe(true);
  });

  it("lets an allowlisted phrase through but not the word on its own", () => {
    const spec = withAllowlist(SPEC, "services", ["holistic therapy"]);
    expect(lintAfter((d) => (d.closing[0] = "Legiit offers holistic therapy."), DATA, spec).passed).toBe(true);
    const report = lintAfter((d) => (d.closing[0] = "Legiit takes a holistic view."), DATA, spec);
    expect(ofKind(report, "banned_word").map((i) => i.text)).toEqual(["holistic"]);
  });

  it("lets a banned word through inside a name from the fact sheet", () => {
    const data = withFields(DATA, { company_name: { ...DATA.fields.company_name, value: "Premier Roofing" } });
    expect(lintAfter((d) => (d.intro[0] = "Premier Roofing fixes roofs in Myrtle Beach."), data).passed).toBe(true);
    const report = lintAfter((d) => (d.intro[0] = "Premier Roofing is a premier company in Myrtle Beach."), data);
    expect(ofKind(report, "banned_word").map((i) => i.text)).toEqual(["premier"]);
  });

  it("lets a banned word through inside a short phrase the fact sheet states, repeated whole", () => {
    const data = withFields(DATA, { category: { ...DATA.fields.category, value: "curated freelance marketplace" } });
    expect(lintAfter((d) => (d.intro[0] = "Legiit is a curated freelance marketplace for business owners."), data).passed).toBe(true);
    // The word on its own, or in another phrase, is still banned.
    const report = lintAfter((d) => (d.intro[0] = "Legiit offers a curated set of freelancers."), data);
    expect(ofKind(report, "banned_word").map((i) => i.text)).toEqual(["curated"]);
    // A long value is not a phrase the page may repeat.
    const long = withFields(DATA, { mission: { ...DATA.fields.mission, value: "We are passionate about helping every business owner on earth to use Legiit and grow with it." } });
    expect(ofKind(lintAfter((d) => (d.intro[0] = "Legiit is passionate about business owners."), long), "banned_word").map((i) => i.text)).toEqual(["passionate"]);
  });

  it("lets a quote paragraph through, and flags the same words outside one", () => {
    const line = "We leverage our network, and we are thrilled!";
    expect(lintAfter((d) => (d.differentiators[0].paragraphs[2] = `> ${line}`)).passed).toBe(true);

    const report = lintAfter((d) => (d.differentiators[0].paragraphs[2] = line));
    expect(new Set(report.issues.map((i) => i.kind))).toEqual(new Set(["banned_word", "first_person", "exclamation"]));
    for (const issue of report.issues) expect(issue.where).toBe("differentiators[0].paragraphs[2]");
  });
});

describe("dashes", () => {
  it("flags an em dash", () => {
    const issue = expectOne(
      (d) => (d.offerings[0].paragraphs[0] = "Vetted freelancers sell productized services on Legiit — one order at a time."),
      "dash",
      "offerings[0].paragraphs[0]",
    );
    expect(issue.hint).toContain("comma");
  });

  it("flags an en dash with spaces around it but not one inside a range", () => {
    expectOne((d) => (d.process[0] = "Legiit is a marketplace – and a business operating system."), "dash", "process[0]");
    expect(lintAfter((d) => (d.process[0] = "Customer success answers Monday–Friday and at weekends.")).passed).toBe(true);
  });
});

describe("numbers", () => {
  it("flags a number that is not in the fact sheet", () => {
    const issue = expectOne(
      (d) =>
        (d.faq[3].answer =
          "Customer success handles it. A person responds in about 90 seconds on average and the average issue is resolved in about 14 minutes."),
      "invented_number",
      "faq[3].answer",
    );
    expect(issue.text).toBe("14");
    expect(issue.hint).toBe("the number 14 is not in the fact sheet; use one that is, or drop it");
  });

  it("reads thousands separators and leading zeros the same on both sides", () => {
    expect(lintAfter((d) => (d.closing[0] = "His savings bottomed out at about $4,000.")).passed).toBe(true);
    expect(lintAfter((d) => (d.closing[0] = "His channel has 100000 subscribers.")).passed).toBe(true);
    expect(lintAfter((d) => (d.closing[0] = "The first 07 days are free.")).passed).toBe(true);
    const issue = expectOne((d) => (d.closing[0] = "His savings bottomed out at about $4,500."), "invented_number", "closing[0]");
    expect(issue.text).toBe("4,500");
  });

  it("counts a year inside a date by its digits", () => {
    const data: FactSheetData = {
      templateId: "about-v1",
      fields: { founded_date: { value: "2018-02-07", status: "found", evidence: [] } },
    };
    const fine = lintDraft(tinyDraft(["Legiit launched on February 7, 2018."]), data, SPEC);
    expect(ofKind(fine, "invented_number")).toEqual([]);
    const wrong = lintDraft(tinyDraft(["Legiit launched on February 8, 2018."]), data, SPEC);
    expect(ofKind(wrong, "invented_number").map((i) => i.text)).toEqual(["8"]);
  });

  it("takes numbers from list item values and conflict candidates", () => {
    // "50 searches" is only in a pricing item's notes, not in any quote.
    expect(lintAfter((d) => (d.closing[0] = "The Starter plan includes 50 searches.")).passed).toBe(true);

    const data = withFields(DATA, {
      phone: {
        value: "843 555 0100",
        status: "conflict",
        evidence: [{ quote: "Call 843 555 0100", url: "https://legiit.com/contact", source: "page" }],
        candidates: [
          { value: "843 555 0199", evidence: [{ quote: "Phone: 843 555 0199", url: "https://legiit.com/about", source: "page" }] },
        ],
      },
    });
    expect(lintAfter((d) => (d.closing[0] = "Call 843 555 0199 to talk to a person."), data).passed).toBe(true);
    // The issue names the number as written; the comparison strips the leading zero on both sides.
    expect(ofKind(lintAfter((d) => (d.closing[0] = "Call 843 555 0177."), data), "invented_number").map((i) => i.text)).toEqual(["0177"]);
  });

  it("still checks the numbers inside a quote paragraph", () => {
    const report = lintAfter((d) => (d.differentiators[0].paragraphs[2] = "> We have 14 offices and we love it!"));
    expect(report.issues.map((i) => `${i.kind}:${i.text}`)).toEqual(["invented_number:14"]);
  });
});

describe("faq", () => {
  it("flags fewer questions than the template asks for", () => {
    const issue = expectOne((d) => (d.faq = d.faq.slice(0, 9)), "faq_count", "faq");
    expect(issue.hint).toContain(String(SPEC.faq.min));
  });

  it("flags more questions than the template allows", () => {
    const issue = expectOne((d) => d.faq.push(d.faq[0], d.faq[1], d.faq[2]), "faq_count", "faq");
    expect(issue.text).toBe("13 questions");
    expect(issue.hint).toContain(String(SPEC.faq.max));
  });

  it("flags an answer with too few or too many sentences", () => {
    const short = expectOne((d) => (d.faq[2].answer = "No."), "faq_length", "faq[2].answer");
    expect(short.hint).toBe("answer in 2 to 3 sentences; this one has 1");
    const long = expectOne(
      (d) => (d.faq[2].answer = "No. You buy one service at a time. You spend what you want. Legiit Leads and Seller Plus are subscriptions."),
      "faq_length",
      "faq[2].answer",
    );
    expect(long.hint).toContain("this one has 4");
  });

  it("does not take an initial, an abbreviation, or a decimal for the end of a sentence", () => {
    expect(lintAfter((d) => (d.faq[9].answer = "Chris M. Walker founded Legiit and runs it as CEO. Jim Sabellico is the co-founder and CTO.")).passed).toBe(true);
    expect(lintAfter((d) => (d.faq[9].answer = "Legiit Leads Inc. sells leads. Plans start at $47 a month.")).passed).toBe(true);
    const decimal = lintAfter((d) => (d.faq[9].answer = "Orders average 4.5 stars. Most ship in a week."));
    expect(ofKind(decimal, "faq_length")).toEqual([]);
    expect(ofKind(decimal, "invented_number").map((i) => i.text)).toEqual(["4.5"]);
  });

  it("walks the questions too", () => {
    expectOne((d) => (d.faq[0].question = "Is Legiit a game changer?"), "banned_word", "faq[0].question");
  });
});

describe("sentences and voice", () => {
  it("flags a sentence over 40 words", () => {
    const words = (n: number) => `${Array.from({ length: n }, () => "word").join(" ")}.`;
    const issue = expectOne((d) => (d.process[0] = words(41)), "long_sentence", "process[0]");
    expect(issue.hint).toContain("41-word");
    expect(lintAfter((d) => (d.process[0] = words(40))).passed).toBe(true);
  });

  it("flags an exclamation mark", () => {
    const issue = expectOne((d) => (d.closing[1] = "Think Big!"), "exclamation", "closing[1]");
    expect(issue.hint).toContain("full stop");
  });

  it("flags first person outside a quote", () => {
    const issue = expectOne((d) => (d.teamSummary[0] = "We are 45 people across six continents."), "first_person", "teamSummary[0]");
    expect(issue.text).toBe("We");
    expect(issue.hint).toContain("third person");
    expectOne((d) => (d.teamSummary[0] = "Our team is 45 people across six continents."), "first_person", "teamSummary[0]");
  });

  it("does not take the US or hours for first person", () => {
    expect(lintAfter((d) => (d.closing[0] = "Legiit is based in the US and answers at all hours.")).passed).toBe(true);
  });

  it("flags a placeholder", () => {
    const issue = expectOne((d) => (d.customers[0] = "[insert segment]"), "placeholder", "customers[0]");
    expect(issue.hint).toContain("[insert");
    for (const text of ["Pricing TBD.", "{{company}} is a marketplace.", "Lorem ipsum dolor sit amet.", "Serves XXX businesses."]) {
      expectOne((d) => (d.customers[0] = text), "placeholder", "customers[0]");
    }
  });

  it("flags an empty entry and nothing else about it", () => {
    expectOne((d) => (d.intro[1] = ""), "empty", "intro[1]");
    expectOne((d) => (d.offerings[0].paragraphs = []), "empty", "offerings[0].paragraphs");
    expectOne((d) => (d.faq[2].answer = "   "), "empty", "faq[2].answer");
    expectOne((d) => (d.metaDescription = ""), "empty", "metaDescription");
    expectOne((d) => (d.team[0].heading = ""), "empty", "team[0].heading");
    expectOne((d) => (d.differentiators[0].paragraphs[2] = "> "), "empty", "differentiators[0].paragraphs[2]");
    const links = expectOne((d) => (d.founders[0].links![0].label = ""), "empty", "founders[0].links[0].label");
    expect(links.hint).toBe("write the text or remove the entry");
  });

  it("walks link labels", () => {
    expectOne((d) => (d.founders[0].links![0].label = "Leverage"), "banned_word", "founders[0].links[0].label");
  });
});
