import { describe, expect, it } from "vitest";
import type { Finding } from "@/lib/facts/types";
import { normalizeForMatch, verifiedQuote, verifyFindings, verifyQuote } from "./verify";

const PAGE = [
  "# About Legiit",
  "",
  "Legiit is a curated freelance marketplace where business owners and agencies buy SEO, content, design, development, video, and automation work from vetted freelancers, one service at a time.",
  "",
  "It launched on February 7, 2018 and has processed over one million orders since. It is an eight figure business run by a team of 45 people across six continents, most of whom have run a business of their own.",
  "",
  "\u201CWe don\u2019t even see them as the same thing.\u201D Chris M. Walker \u2013 Founder and CEO",
  "",
  "Average first response is about 90 seconds\u00A0and the average issue is resolved in about 12 minutes.",
].join("\n");

const finding = (source: Finding["source"], quote: string): Finding => ({
  fieldId: "founded_date",
  value: "2018",
  quote,
  url: "https://legiit.com/about",
  source,
  confidence: 0.9,
});

describe("normalizeForMatch", () => {
  it("lowercases, straightens quotes and dashes, and collapses whitespace", () => {
    expect(normalizeForMatch("  \u201CHello\u201D\u00A0\u2014\tWorld  ")).toBe('"hello" - world');
    expect(normalizeForMatch("don\u2019t\n\n  stop")).toBe("don't stop");
  });
});

describe("verifyQuote", () => {
  it("accepts an exact substring", () => {
    expect(
      verifyQuote("It launched on February 7, 2018 and has processed over one million orders since.", PAGE),
    ).toBe(true);
  });

  it("ignores whitespace, non-breaking spaces, curly quotes, and dash styles", () => {
    expect(
      verifyQuote("\"We don't even see them as the same thing.\" Chris M. Walker - Founder and CEO", PAGE),
    ).toBe(true);
    expect(
      verifyQuote("Average first response is about 90 seconds and the\n   average issue is resolved in about 12 minutes.", PAGE),
    ).toBe(true);
    expect(verifyQuote("A TEAM OF 45 PEOPLE ACROSS SIX CONTINENTS", PAGE)).toBe(true);
  });

  it("rejects a paraphrase", () => {
    expect(verifyQuote("Legiit launched in 2018 and has handled a million orders", PAGE)).toBe(false);
    expect(verifyQuote("", PAGE)).toBe(false);
  });

  it("does not accept a long quote on its first 80 characters", () => {
    const start =
      "Legiit is a curated freelance marketplace where business owners and agencies buy SEO, content, design";
    expect(start.length).toBeGreaterThan(80);
    expect(verifyQuote(`${start} and other things the model made up`, PAGE)).toBe(false);
  });
});

describe("verifiedQuote", () => {
  const page = normalizeForMatch(PAGE);
  const start =
    "Legiit is a curated freelance marketplace where business owners and agencies buy SEO, content, design";

  it("returns the whole quote when it is on the page", () => {
    expect(verifiedQuote("It launched on February 7, 2018", page)).toEqual({ text: "It launched on February 7, 2018", partial: false });
    // Wrapping quote marks and a trailing period the page does not have are left off.
    expect(verifiedQuote('"A team of 45 people across six continents."', page)).toEqual({
      text: "A team of 45 people across six continents",
      partial: false,
    });
  });

  it("keeps the longest leading run of words of a long quote that is on the page, and only a long one", () => {
    expect(verifiedQuote(`${start} and other things the model made up`, page)).toEqual({ text: start, partial: true });
    // A run under 80 characters is not evidence.
    expect(verifiedQuote("It launched on February 7, 2018 and then it made up a tail", page)).toBeNull();
    // A long quote whose start is wrong has no run at all.
    expect(verifiedQuote(`Our marketplace ${start}`, page)).toBeNull();
  });
});

describe("verifyFindings", () => {
  it("drops page findings with an unverifiable quote and keeps deterministic ones", () => {
    const good = finding("page", "It launched on February 7, 2018");
    const bad = finding("page", "Founded in 2018 by Chris");
    const jsonld = finding("jsonld", "2018-02-07");
    const link = finding("link", "tel:+15555555555");
    const { kept, dropped } = verifyFindings([good, bad, jsonld, link], PAGE);
    expect(kept).toEqual([good, jsonld, link]);
    expect(dropped).toEqual([bad]);
  });
});

describe("verifyFindings value checks", () => {
  const ABOUT_US = "https://darcybaileycounselling.com/about-us/";
  const INTRO =
    "Darcy Bailey & Associates Counselling is a counselling practice in Langley, BC that provides in-person and online therapy for children, teens, adults, couples, and families across British Columbia.";
  const DARCY = [
    "# About Darcy Bailey & Associates Counselling",
    INTRO,
    "We have been serving Langley for 17+ years and have helped 25,000+ clients.",
    "Call 604-533-9163 to book. Office hours are Monday to Thursday, 9am to 8pm.",
    "Individual counselling is $170 per 50-minute session, or $175 with a senior therapist. Couples, marriage, and family sessions are $195.",
    "## Our team",
    "Swetha Ranasuriya, MA, DVATI, RCC, RCAT",
    "Swetha works with children 5+, teens, adults, and families, using EMDR and art therapy.",
    "Darcy opened the practice in 2006 after two decades as a social worker in Langley.",
    "It launched on February 7, 2018 with online booking.",
  ].join("\n");
  const FABRICATED_TAIL =
    "Darcy Bailey & Associates Counselling is a counselling practice in Langley, BC that provides therapy since it was founded in 2003";

  const page = (fieldId: string, value: Finding["value"], quote: string): Finding => ({
    fieldId,
    value,
    quote,
    url: ABOUT_US,
    source: "page",
    confidence: 0.9,
  });

  function check(f: Finding) {
    const { kept, dropped, reasons } = verifyFindings([f], DARCY);
    return { kept: kept[0] ?? null, dropped: dropped.length, reason: reasons[0] ?? null };
  }

  it("drops a value that sits in a fabricated tail after the part of the quote that is on the page (EXT-1)", () => {
    const r = check(page("founded_date", "2003", FABRICATED_TAIL));
    expect(r.dropped).toBe(1);
    expect(r.reason).toBe("founded_date: the year 2003 is not in the quote");
  });

  it("keeps a value the verified start of a long quote supports, with that start as the quote", () => {
    const r = check(page("category", "counselling practice in Langley, BC", FABRICATED_TAIL));
    expect(r.kept?.quote).toBe(
      "Darcy Bailey & Associates Counselling is a counselling practice in Langley, BC that provides",
    );
    expect(r.kept?.value).toBe("counselling practice in Langley, BC");
    // The years claim after the verified start is not supported by it.
    const years = check(
      page("years_in_business", "17+ years", `${FABRICATED_TAIL.replace(/ since.*$/, "")} and has served Langley for 17+ years`),
    );
    expect(years.reason).toBe("years_in_business: 17 is not in the quote");
  });

  it("drops values that disagree with their quote (EXT-2)", () => {
    expect(check(page("years_in_business", "25+ years", "serving Langley for 17+ years")).reason).toBe(
      "years_in_business: 25 is not in the quote",
    );
    expect(check(page("phone", "604-533-9164", "Call 604-533-9163 to book.")).reason).toBe(
      "phone: the number 604-533-9164 is not in the quote",
    );
    expect(
      check(page("pricing", [{ name: "Couples counselling", price: "$185" }], "Couples, marriage, and family sessions are $195."))
        .reason,
    ).toBe("pricing: price: 185 is not in the quote");
  });

  it("keeps honest values", () => {
    const honest = [
      page("phone", "604-533-9163", "Call 604-533-9163"),
      page("phone", "+1 (604) 533-9163", "Call 604-533-9163"),
      page("founded_date", "2018-02-07", "It launched on February 7, 2018"),
      page("founded_date", "2018", "It launched on February 7, 2018"),
      page("years_in_business", "17+ years", "serving Langley for 17+ years"),
      page("pricing", [{ name: "Individual counselling", price: "$170" }], "Individual counselling is $170 per 50-minute session"),
      page(
        "team_members",
        [{ name: "Swetha Ranasuriya", role: "Registered Clinical Counsellor" }],
        "Swetha Ranasuriya, MA, DVATI, RCC, RCAT",
      ),
      page("category", "counselling practice in Langley, BC", INTRO),
      page("customers_served", "25000+ clients", "have helped 25,000+ clients"),
      page("hours", [{ days: "Monday to Thursday", opens: "9:00 AM", closes: "8:00 PM" }], "Office hours are Monday to Thursday, 9am to 8pm."),
      page("business_type", "MedicalBusiness", "a counselling practice in Langley, BC"),
      page(
        "origin_story",
        "Darcy Bailey opened the practice in 2006 after working for two decades as a social worker in Langley.",
        "Darcy opened the practice in 2006",
      ),
    ];
    const { kept, dropped, reasons } = verifyFindings(honest, DARCY);
    expect(reasons).toEqual([]);
    expect(dropped).toEqual([]);
    expect(kept).toEqual(honest);
  });

  it("checks the year, the day, and a named month of a date, not a month number", () => {
    expect(check(page("founded_date", "2018-03-07", "It launched on February 7, 2018")).reason).toBe(
      "founded_date: the month is not the one the quote names",
    );
    expect(check(page("founded_date", "2018-02-09", "It launched on February 7, 2018")).reason).toBe(
      "founded_date: 9 is not in the quote",
    );
    expect(check(page("founded_date", "02/07/2018", "It launched on February 7, 2018")).dropped).toBe(0);
  });

  it("drops an invented name and keeps a paraphrase that uses the page's words", () => {
    expect(
      check(page("team_members", [{ name: "Ann Lee", role: "Registered Clinical Counsellor" }], "Swetha Ranasuriya, MA, DVATI, RCC, RCAT"))
        .reason,
    ).toBe("team_members: name: only 0 of 2 words are in the quote or on the page");
    expect(check(page("ideal_customer", "veterans and first responders", INTRO)).reason).toBe(
      "ideal_customer: only 0 of 3 words are on the page",
    );
    expect(check(page("ideal_customer", "children, teens, adults, couples, and families", INTRO)).dropped).toBe(0);
  });

  it("checks long text against the page: its numbers and most of its words", () => {
    expect(
      check(page("origin_story", "Darcy opened the practice in 2003 after two decades as a social worker.", "Darcy opened the practice in 2006"))
        .reason,
    ).toBe("origin_story: 2003 is not on the page");
    expect(
      check(page("origin_story", "The founder trained as a pilot and sold aircraft parts in Toronto.", "Darcy opened the practice in 2006"))
        .reason,
    ).toMatch(/^origin_story: only \d of \d+ words are on the page$/);
  });

  it("leaves out an optional item key the quote does not support and keeps the item", () => {
    const service = page(
      "services",
      [{ name: "Couples counselling", description: "Counselling for couples, marriage, and families.", price: "$185" }],
      "Couples, marriage, and family sessions are $195.",
    );
    const r = check(service);
    expect(r.dropped).toBe(0);
    expect(r.kept?.value).toEqual([{ name: "Couples counselling", description: "Counselling for couples, marriage, and families." }]);
    // The input is not mutated.
    expect(service.value).toEqual([
      { name: "Couples counselling", description: "Counselling for couples, marriage, and families.", price: "$185" },
    ]);
  });

  it("reads numbers the quote spells out", () => {
    const team = "Fourteen therapists, one clinical director, and three client care staff, all based in Langley, BC.";
    const { kept, reasons } = verifyFindings(
      [page("team_size", "14 therapists, 1 clinical director, and 3 client care staff", team)],
      `${DARCY}\n${team}`,
    );
    expect(reasons).toEqual([]);
    expect(kept).toHaveLength(1);
    expect(
      verifyFindings([page("team_size", "15 therapists", team)], `${DARCY}\n${team}`).reasons,
    ).toEqual(["team_size: 15 is not in the quote"]);
  });

  it("returns a reason for every dropped finding, in order", () => {
    const { kept, dropped, reasons } = verifyFindings(
      [
        page("phone", "604-533-9164", "Call 604-533-9163 to book."),
        page("phone", "604-533-9163", "Call 604-533-9163 to book."),
        page("founded_date", "2018", "Founded in 2018 by Darcy"),
      ],
      DARCY,
    );
    expect(kept).toHaveLength(1);
    expect(dropped.map((f) => f.quote)).toEqual(["Call 604-533-9163 to book.", "Founded in 2018 by Darcy"]);
    expect(reasons).toEqual([
      "phone: the number 604-533-9164 is not in the quote",
      "founded_date: the quote is not on the page",
    ]);
  });
});
