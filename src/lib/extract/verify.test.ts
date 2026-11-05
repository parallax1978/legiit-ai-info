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

  it("keeps a date's month and day only when the quote states them, and cuts the rest back to the year (DATE-MONTH)", () => {
    const LAUNCH = "It launched on February 7, 2018";
    const valueOf = (value: string, quote: string, text = DARCY) => {
      const r = verifyFindings([page("founded_date", value, quote)], text);
      return r.kept[0]?.value ?? r.reasons[0];
    };
    // The quote's month and day support the ISO date and one reading of the numeric one.
    expect(valueOf("2018-02-07", LAUNCH)).toBe("2018-02-07");
    expect(valueOf("02/07/2018", LAUNCH)).toBe("02/07/2018");
    expect(valueOf("07/02/2018", LAUNCH)).toBe("07/02/2018");
    // A month the quote does not state is not kept; the year is.
    expect(valueOf("2018-03-07", LAUNCH)).toBe("2018");
    expect(valueOf("03/07/2018", LAUNCH)).toBe("2018");
    expect(valueOf("12/07/2018", LAUNCH)).toBe("2018");
    // The right month with the wrong day keeps the month.
    expect(valueOf("2018-02-09", LAUNCH)).toBe("2018-02");
    // "The spring of 2018" names no month, so neither an ISO month nor a month name survives.
    const spring = "We opened our doors in the spring of 2018 with two therapists.";
    expect(valueOf("2018-03", "in the spring of 2018", spring)).toBe("2018");
    expect(valueOf("May 2018", "in the spring of 2018", spring)).toBe("2018");
    expect(valueOf("2018", "in the spring of 2018", spring)).toBe("2018");
    // A month the quote does name is kept, written either way.
    const march = "We opened our doors in March 2018 with two therapists.";
    expect(valueOf("2018-03", "in March 2018", march)).toBe("2018-03");
    expect(valueOf("March 2018", "in March 2018", march)).toBe("March 2018");
    // A year the quote does not give is still dropped.
    expect(valueOf("2019", "in March 2018", march)).toBe("founded_date: the year 2019 is not in the quote");
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

describe("keys the model words itself", () => {
  const page =
    "A credit card is required to book and is charged on the day of the session. " +
    "Cancellations need 48 hours' notice, or the full session fee is charged. " +
    "Over 70 percent of clients come from word of mouth.";
  const finding = (fieldId: string, item: Record<string, string>, quote: string) => ({
    fieldId,
    value: [item],
    quote,
    url: "https://x.test/rates",
    source: "page" as const,
    confidence: 0.9,
  });

  it("keeps a policy whose short label is not on the page when its detail is", () => {
    const r = verifyFindings(
      [finding("policies", { name: "Payment", detail: "A credit card is required to book and is charged on the day of the session." }, "A credit card is required to book")],
      page,
    );
    expect(r.dropped).toEqual([]);
  });

  it("still requires a label's numbers to be in the quote", () => {
    const r = verifyFindings(
      [finding("policies", { name: "24-hour cancellation", detail: "Cancellations need 48 hours' notice, or the full session fee is charged." }, "Cancellations need 48 hours' notice")],
      page,
    );
    expect(r.dropped).toHaveLength(1);
    expect(r.reasons[0]).toContain("24");
  });

  it("drops a longer claim whose words are mostly not on the page", () => {
    const r = verifyFindings(
      [finding("track_record", { claim: "The most trusted award winning counselling team nationwide" }, "Over 70 percent of clients come from word of mouth.")],
      page,
    );
    expect(r.dropped).toHaveLength(1);
  });

  it("keeps a longer claim with half its words on the page", () => {
    const r = verifyFindings(
      [finding("track_record", { claim: "Most clients come by word of mouth" }, "Over 70 percent of clients come from word of mouth.")],
      page,
    );
    expect(r.dropped).toEqual([]);
  });
});

/** Lines of the cleaned text of examples/darcy-bailey-about-page.html, verbatim. */
const DARCY_PAGE = [
  "### EMDR therapy",
  "Eye Movement Desensitization and Reprocessing for trauma, PTSD, phobias, and experiences that are over but still running. Six therapists on the team are trained in EMDR, including EMDRIA-trained clinicians. EMDR is available in person and virtually.",
  "Fourteen therapists cover children, teens, adults, couples, and families, with Spanish-speaking sessions available.",
  "Fees are $170 per session, or $175 with a senior therapist.",
  "It won the Canadian Choice Award in 2024 (Mental Health Services, Langley) and again in 2025, the Langley Advance Times Readers' Choice Best of the Best award in 2024 and Best in Langley in 2025, and a Three Best Rated award for marriage counselling in Langley in 2024.",
  "### Darcy Bailey, MSW, RSW, RCC, DipAT, Founder, Owner, and Clinical Director",
  "- Swetha Ranasuriya, MA, DVATI, RCC, RCAT. Children 5+, teens, adults, and families. EMDR and art therapy.",
  "- Pal Manhas, M.Ed, RCC, CCPT. Teens, adults, couples, and families. Gottman Method Levels 1 to 3, certified sex therapy informed practice, EMDR.",
  "Practice on Facebook and Instagram. [add links: LinkedIn, YouTube, Google Business Profile]",
  "Sessions are 50 minutes, with 75-minute sessions available for a higher fee. In-person sessions are at #315, 20385 64 Avenue, Langley, with free parking. Virtual sessions are by secure video anywhere in British Columbia. A credit card is required to book and is charged on the day of the session. You receive an official receipt to submit to your extended health plan; the practice does not bill insurers directly. Cancellations need 48 hours' notice or the full fee is charged, with one late cancellation for illness allowed every 90 days at no charge.",
  "Type | Privately owned counselling and psychotherapy practice. Registered Clinical Counsellors and Registered Social Workers; no psychologists or psychiatrists on staff",
  "Pricing | Free 15-minute consultation. Individual counselling $170 per 50-minute session. Senior therapist $175.",
  "Website | darcybaileycounselling.com",
  "### Is counselling covered by MSP or extended health benefits?",
  "BC MSP does not cover private counselling.",
  "No. The therapists are Registered Clinical Counsellors and Registered Social Workers, who provide therapy but not formal diagnoses or psychological testing. If you need an assessment or diagnosis, a registered psychologist is the right referral.",
].join("\n");

const SWETHA = "Swetha Ranasuriya, MA, DVATI, RCC, RCAT. Children 5+, teens, adults, and families. EMDR and art therapy.";
const DARCY_HEADING = "Darcy Bailey, MSW, RSW, RCC, DipAT, Founder, Owner, and Clinical Director";
const FOURTEEN = "Fourteen therapists cover children, teens, adults, couples, and families, with Spanish-speaking sessions available.";
const EMDR = "Eye Movement Desensitization and Reprocessing for trauma, PTSD, phobias, and experiences that are over but still running.";
const CARD = "A credit card is required to book and is charged on the day of the session.";

function item(fieldId: string, value: Record<string, string>, quote: string, text = DARCY_PAGE, url = "https://darcybaileycounselling.com/about-us/") {
  const r = verifyFindings([{ fieldId, value: [value], quote, url, source: "page", confidence: 0.9 }], text);
  return { kept: Array.isArray(r.kept[0]?.value) ? r.kept[0].value[0] : null, reason: r.reasons[0] ?? null };
}

describe("list item keys besides the identity (EXT2-ITEMS)", () => {
  it("leaves out credentials the page does not give and specialties whose words it does not use", () => {
    const r = item(
      "team_members",
      { name: "Swetha Ranasuriya", role: "Registered Psychologist", credentials: "PhD, CPsych", specialties: "Neuropsychological testing" },
      SWETHA,
    );
    // The role's words are on this page ("a registered psychologist is the right referral"),
    // so a word check cannot tell it from an honest role; the invented codes and specialty go.
    expect(r.kept).toEqual({ name: "Swetha Ranasuriya", role: "Registered Psychologist" });

    const honest = { name: "Swetha Ranasuriya", role: "Registered Clinical Counsellor", credentials: "MA, DVATI, RCC, RCAT", specialties: "Children 5+, teens, adults, and families. EMDR and art therapy." };
    expect(item("team_members", honest, SWETHA).kept).toEqual(honest);
    // Codes match with or without their periods.
    expect(item("team_members", { name: "Pal Manhas", role: "Registered Clinical Counsellor", credentials: "MEd, RCC, CCPT" }, "Pal Manhas, M.Ed, RCC, CCPT.").kept?.credentials).toBe("MEd, RCC, CCPT");
  });

  it("checks a founder's title and credentials, and drops the founder when the required title is not supported", () => {
    const r = item("founders", { name: "Darcy Bailey", title: "Founder, Owner, and Clinical Director", credentials: "PhD, RPsych" }, DARCY_HEADING);
    expect(r.kept).toEqual({ name: "Darcy Bailey", title: "Founder, Owner, and Clinical Director" });
    expect(item("founders", { name: "Darcy Bailey", title: "Founder", credentials: "MSW, RSW, RCC, DipAT" }, DARCY_HEADING).kept?.credentials).toBe("MSW, RSW, RCC, DipAT");
    expect(item("founders", { name: "Darcy Bailey", title: "Chief Medical Officer" }, DARCY_HEADING).reason).toBe(
      "founders: title: only 0 of 3 words are on the page",
    );
  });

  it("counts a role that spells out a code in the quote as on the page", () => {
    // "Registered Clinical Counsellor" is what RCC stands for; this page never writes it out.
    const page = "Swetha Ranasuriya, MA, DVATI, RCC, RCAT. Children 5+, teens, adults, and families.";
    expect(item("team_members", { name: "Swetha Ranasuriya", role: "Registered Clinical Counsellor" }, page, page).kept?.role).toBe(
      "Registered Clinical Counsellor",
    );
    expect(item("team_members", { name: "Swetha Ranasuriya", role: "Registered Dietitian" }, page, page).reason).toBe(
      "team_members: role: only 0 of 2 words are on the page",
    );
  });

  it("leaves out an issuer and notes the page does not state", () => {
    const awards = "It won the Canadian Choice Award in 2024 (Mental Health Services, Langley) and again in 2025";
    expect(item("awards", { name: "Canadian Choice Award", issuer: "Better Business Bureau", year: "2024" }, awards).kept).toEqual({
      name: "Canadian Choice Award",
      year: "2024",
    });
    expect(item("awards", { name: "Canadian Choice Award", issuer: "Canadian Choice Awards" }, awards).kept?.issuer).toBe("Canadian Choice Awards");
    const fees = "Fees are $170 per session, or $175 with a senior therapist.";
    expect(item("pricing", { name: "Individual counselling", price: "$170", notes: "GST included, covered by MSP" }, fees).kept).toEqual({
      name: "Individual counselling",
      price: "$170",
    });
    expect(item("pricing", { name: "Individual counselling", price: "$170", notes: "or $175 with a senior therapist" }, fees).kept?.notes).toBe(
      "or $175 with a senior therapist",
    );
  });

  it("reads a price from its quote, not from anywhere on the page", () => {
    // "free" is on the page (free parking, a free consultation) but not in what the EMDR quote says.
    expect(item("services", { name: "EMDR therapy", description: EMDR, price: "Free" }, EMDR).kept).toEqual({ name: "EMDR therapy", description: EMDR });
    expect(item("pricing", { name: "EMDR therapy", price: "Free" }, EMDR).reason).toBe("pricing: price: only 0 of 1 words are in the quote");
    expect(item("pricing", { name: "Consultation", price: "Free" }, "Free 15-minute consultation.").kept?.price).toBe("Free");
  });

  it("needs a word of a short segment or claim in the quote or on the page", () => {
    expect(item("customer_segments", { segment: "Veterans" }, FOURTEEN).reason).toBe(
      "customer_segments: segment: none of its words are in the quote or on the page",
    );
    expect(item("differentiators", { claim: "Fully insured" }, FOURTEEN).reason).toBe(
      "differentiators: claim: none of its words are in the quote or on the page",
    );
    expect(item("track_record", { claim: "Industry leader" }, FOURTEEN).reason).toBe(
      "track_record: claim: none of its words are in the quote or on the page",
    );
    expect(item("customer_segments", { segment: "Couples" }, FOURTEEN).kept).toEqual({ segment: "Couples" });
    expect(item("differentiators", { claim: "Spanish-speaking sessions" }, FOURTEEN).kept).toEqual({ claim: "Spanish-speaking sessions" });
  });

  it("keeps a policy heading in the model's words only over a quote about the policy", () => {
    const cancellation = "Cancellations need 48 hours' notice or the full fee is charged, with one late cancellation for illness allowed every 90 days at no charge.";
    expect(item("policies", { name: "Sliding scale", detail: cancellation }, FOURTEEN).reason).toBe("policies: name: the quote is not about this item");
    const topical = "Sessions are 50 minutes, with 75-minute sessions available for a higher fee.";
    expect(item("policies", { name: "Sliding scale", detail: topical }, FOURTEEN).reason).toBe("policies: name: the quote is not about this item");
    expect(item("policies", { name: "Payment", detail: CARD }, CARD).kept).toEqual({ name: "Payment", detail: CARD });
    expect(item("policies", { name: "Cancellation", detail: cancellation }, cancellation).kept).toEqual({ name: "Cancellation", detail: cancellation });
    // A long quote that holds the policy among other sentences is still about it.
    const paragraph =
      "Virtual sessions are by secure video anywhere in British Columbia. A credit card is required to book and is charged on the day of the session. You receive an official receipt to submit to your extended health plan; the practice does not bill insurers directly.";
    expect(item("policies", { name: "Payment", detail: CARD }, paragraph).kept).toEqual({ name: "Payment", detail: CARD });
  });

  it("leaves out a person's link the page does not show, and keeps the page's own address", () => {
    const profile = "https://darcybaileycounselling.com/darcy-bailey/";
    const r = item("founders", { name: "Darcy Bailey", title: "Founder", url: profile, linkedin: "https://www.linkedin.com/in/darcybailey" }, DARCY_HEADING, DARCY_PAGE, profile);
    expect(r.kept).toEqual({ name: "Darcy Bailey", title: "Founder", url: profile });
    // Read from another page, the profile address is not on this one.
    expect(item("founders", { name: "Darcy Bailey", title: "Founder", url: profile }, DARCY_HEADING).kept).toEqual({ name: "Darcy Bailey", title: "Founder" });
  });
});

describe("social links and handles (EXT2-HANDLE)", () => {
  const LEGIIT_SOCIAL = "Social | Legiit: YouTube, LinkedIn, X, Facebook. Chris M. Walker: YouTube, Instagram @cmwlegiit, LinkedIn, X, Facebook, chrismwalker.io";
  const social = (url: string, quote: string, text: string) => item("social_profiles", { platform: platformOf(url), url }, quote, text);
  const platformOf = (url: string) => new URL(url).hostname.replace(/^www\./, "").split(".")[0];

  it("does not take a handle built from the business's domain or name", () => {
    expect(social("https://www.facebook.com/darcybaileycounselling", "Practice on Facebook and Instagram.", DARCY_PAGE).reason).toBe(
      "social_profiles: url: the link is not on the page",
    );
    expect(social("https://www.facebook.com/legiit", "Legiit: YouTube, LinkedIn, X, Facebook", LEGIIT_SOCIAL).reason).toBe(
      "social_profiles: url: the link is not on the page",
    );
    expect(social("https://www.linkedin.com/in/chris", "Chris M. Walker: YouTube, Instagram @cmwlegiit, LinkedIn, X, Facebook", LEGIIT_SOCIAL).reason).toBe(
      "social_profiles: url: the link is not on the page",
    );
  });

  it("takes a handle the quote shows as a handle, and an address the page shows in full", () => {
    expect(social("https://www.instagram.com/cmwlegiit/", "Instagram @cmwlegiit", LEGIIT_SOCIAL).kept?.url).toBe("https://www.instagram.com/cmwlegiit/");
    const page = `${LEGIIT_SOCIAL}\nWatch us at youtube.com/@LegiitOfficial and facebook.com/legiitofficial.`;
    expect(social("https://www.youtube.com/@LegiitOfficial", "YouTube", page).kept).not.toBeNull();
    expect(social("https://www.facebook.com/legiitofficial", "Facebook", page).kept).not.toBeNull();
    // A shorter address is not shown by a longer one that starts with it.
    expect(social("https://www.facebook.com/legiit", "Facebook", page).reason).toBe("social_profiles: url: the link is not on the page");
  });

  it("leaves a guessed profile out of a person and keeps the one the quote shows", () => {
    const r = item(
      "founders",
      { name: "Chris M. Walker", title: "Founder", instagram: "https://www.instagram.com/cmwlegiit", linkedin: "https://www.linkedin.com/in/chris" },
      "Chris M. Walker: YouTube, Instagram @cmwlegiit, LinkedIn, X, Facebook, chrismwalker.io",
      `${LEGIIT_SOCIAL}\nChris M. Walker, Founder and CEO`,
    );
    expect(r.kept).toEqual({ name: "Chris M. Walker", title: "Founder", instagram: "https://www.instagram.com/cmwlegiit" });
  });
});

describe("opening hours (HOURS-DROP)", () => {
  const hours = (value: Record<string, string>, quote: string) => item("hours", value, quote, quote);

  it("reads abbreviated days and 24-hour times as the days and times they are", () => {
    for (const [value, quote] of [
      [{ days: "Monday to Thursday", opens: "9 AM", closes: "8 PM" }, "Mon - Thu: 9am - 8pm"],
      [{ days: "Mon - Thu", opens: "9am", closes: "8pm" }, "Mon - Thu: 9am - 8pm"],
      [{ days: "Monday to Friday", opens: "9:00 AM", closes: "5:00 PM" }, "Mon-Fri 09:00-17:00"],
      [{ days: "Monday to Friday", opens: "8 AM", closes: "5 PM" }, "Weekdays 8am to 5pm"],
      [{ days: "Monday", opens: "9:00 AM", closes: "5:00 PM" }, "Mon-Fri 9-5pm"],
      [{ days: "Sunday", opens: "Closed", closes: "Closed" }, "Sunday: closed"],
    ] as const) {
      expect(hours(value, quote)).toEqual({ kept: value, reason: null });
    }
  });

  it("still drops a day or a time the quote does not give", () => {
    expect(hours({ days: "Monday to Saturday", opens: "9 AM", closes: "5 PM" }, "Mon-Fri 9am-5pm").reason).toBe(
      "hours: days: Saturday is not in the quote",
    );
    expect(hours({ days: "Monday to Thursday", opens: "9 AM", closes: "6 PM" }, "Mon - Thu: 9am - 8pm").reason).toBe(
      "hours: closes: 6 PM is not in the quote",
    );
    // 8 is in the quote, but as 8 in the evening.
    expect(hours({ days: "Monday to Thursday", opens: "8 AM", closes: "8 PM" }, "Mon - Thu: 9am - 8pm").reason).toBe(
      "hours: opens: 8 AM is not in the quote",
    );
  });
});
