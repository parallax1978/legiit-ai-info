import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FactField, FactSheetData, FactStatus, FactValue, ListItem } from "@/lib/facts/types";
import { ABOUT_V1 } from "@/templates/about-v1";
import {
  buildJsonLd,
  currencyCode,
  currencySymbol,
  firstSentence,
  geoCoordinates,
  isLocalBusinessType,
  isoDate,
  languageCode,
  openingHours,
  orgType,
  parsePrice,
  prune,
  siteOrigin,
  teamCount,
} from "./jsonld";
import type { PageDraft } from "./types";

type Node = Record<string, unknown>;

function loadFixture(name: "legiit" | "darcy-bailey"): FactSheetData {
  const file = path.join(process.cwd(), "examples", "fixtures", `${name}.factsheet.json`);
  return JSON.parse(readFileSync(file, "utf8")) as FactSheetData;
}

/** The graph in examples/legiit-schema.html: the JSON between the script tags. */
function exampleGraph(): Node[] {
  const html = readFileSync(path.join(process.cwd(), "examples", "legiit-schema.html"), "utf8");
  const json = html.slice(html.indexOf("{"), html.lastIndexOf("}") + 1);
  return (JSON.parse(json) as { "@graph": Node[] })["@graph"];
}

function withFields(data: FactSheetData, fields: Record<string, FactField>): FactSheetData {
  const copy = JSON.parse(JSON.stringify(data)) as FactSheetData;
  Object.assign(copy.fields, fields);
  return copy;
}

function field(value: FactValue, status: FactStatus = "found"): FactField {
  return { value, status, evidence: [] };
}

const missing = (): FactField => field(null, "missing");

const INTRO =
  "Legiit is a curated freelance marketplace where business owners and agencies buy SEO, content, design, development, video, and automation work from vetted freelancers, one service at a time.";

/** A small draft; the FAQ is the fixture's existing_faqs, which the example page carries word for word. */
function sampleDraft(data: FactSheetData): PageDraft {
  const faqs = (data.fields.existing_faqs?.value ?? []) as ListItem[];
  return {
    metaTitle: "About Legiit | Curated Freelance Marketplace",
    metaDescription: INTRO,
    title: "About Legiit",
    intro: [INTRO, "It launched on February 7, 2018 and has processed over one million orders since."],
    offerings: [{ heading: "The marketplace", paragraphs: ["Vetted freelancers sell productized services on Legiit."] }],
    differentiators: [{ heading: "The freelancers are vetted", paragraphs: ["Legiit vets freelancers before they can sell."] }],
    customers: ["Business owners priced out of a traditional agency retainer."],
    founders: [{ heading: "Chris M. Walker, Founder and CEO", paragraphs: ["Chris grew up in North Myrtle Beach, South Carolina."] }],
    originStory: ["Legiit launched on February 7, 2018."],
    team: [{ heading: "Jessica Lavatai, COO", paragraphs: ["Jessica runs sales, community, and customer success."] }],
    teamSummary: ["Legiit is 45 people across six continents."],
    process: ["For buyers: create an account and search by service or category."],
    faq: faqs.map((f) => ({ question: f.question ?? "", answer: f.answer ?? "" })),
    closing: ["Think Big."],
    stillToFill: [],
  };
}

function build(data: FactSheetData, draft = sampleDraft(data), siteUrl = "https://legiit.com", pageUrl = "https://legiit.com/about") {
  const jsonld = buildJsonLd({ spec: ABOUT_V1, data, draft, siteUrl, pageUrl });
  const graph = jsonld["@graph"] as Node[];
  return { jsonld, org: graph[0], page: graph[1] };
}

/** Every empty string, null, undefined, empty array, or empty object anywhere in the value, by path. */
function emptyPaths(value: unknown, at = "$"): string[] {
  if (value === null || value === undefined) return [at];
  if (typeof value === "string") return value.trim() ? [] : [at];
  if (Array.isArray(value)) return value.length ? value.flatMap((v, i) => emptyPaths(v, `${at}[${i}]`)) : [at];
  if (typeof value === "object") {
    const entries = Object.entries(value as Node);
    return entries.length ? entries.flatMap(([k, v]) => emptyPaths(v, `${at}.${k}`)) : [at];
  }
  return [];
}

function people(nodes: unknown): Node[] {
  return Array.isArray(nodes) ? (nodes as Node[]) : [];
}

describe("buildJsonLd against examples/legiit-schema.html", () => {
  const data = loadFixture("legiit");
  const [exampleOrg, examplePage] = exampleGraph();
  const { jsonld, org, page } = build(data);

  it("has the context and a graph of the organization and the page", () => {
    expect(jsonld["@context"]).toBe("https://schema.org");
    expect((jsonld["@graph"] as Node[]).length).toBe(2);
  });

  it("matches the example organization on type, id, name, url, logo, founding date, and description", () => {
    for (const key of ["@type", "@id", "name", "url", "logo", "foundingDate", "description"]) {
      expect(org[key], key).toEqual(exampleOrg[key]);
    }
  });

  it("matches the example founders on names, job titles, urls, and sameAs", () => {
    const ours = people(org.founder);
    const theirs = people(exampleOrg.founder);
    expect(ours.map((p) => p.name)).toEqual(theirs.map((p) => p.name));
    expect(ours.map((p) => p.jobTitle)).toEqual(theirs.map((p) => p.jobTitle));
    expect(ours.map((p) => p.url)).toEqual(theirs.map((p) => p.url));
    expect(ours.map((p) => p.sameAs)).toEqual(theirs.map((p) => p.sameAs));
  });

  it("matches the example employees on names and job titles", () => {
    const ours = people(org.employee);
    const theirs = people(exampleOrg.employee);
    expect(ours.map((p) => p.name)).toEqual(theirs.map((p) => p.name));
    expect(ours.map((p) => p.jobTitle)).toEqual(theirs.map((p) => p.jobTitle));
  });

  it("matches the example address and sameAs", () => {
    expect(org.address).toEqual(exampleOrg.address);
    expect(org.sameAs).toEqual(exampleOrg.sameAs);
  });

  it("carries every example property, plus the two the fixture has values for", () => {
    for (const key of Object.keys(exampleOrg)) expect(key in org, key).toBe(true);
    // The hand-made example predates these two: the fixture states a team size (45 people) and
    // six pricing items with one amount each, so numberOfEmployees and hasOfferCatalog appear here.
    expect(Object.keys(org).filter((k) => !(k in exampleOrg))).toEqual(["numberOfEmployees", "hasOfferCatalog"]);
    expect(org.numberOfEmployees).toEqual({ "@type": "QuantitativeValue", value: 45 });
    const catalog = org.hasOfferCatalog as Node;
    const offers = catalog.itemListElement as Node[];
    expect(offers.map((o) => [o.name, o.price, o.priceCurrency])).toEqual([
      ["Account", "0", "USD"],
      ["Legiit Leads Starter", "47", "USD"],
      ["Legiit Leads Agency", "97", "USD"],
      ["Legiit Leads Agency Pro", "297", "USD"],
      ["Legiit Leads Agency Empire", "497", "USD"],
      ["Seller Plus", "27", "USD"],
    ]);
  });

  it("matches the example page node", () => {
    for (const key of ["@type", "@id", "url", "name", "description", "inLanguage", "about"]) {
      expect(page[key], key).toEqual(examplePage[key]);
    }
    expect(page.mainEntity).toEqual(examplePage.mainEntity);
  });

  it("repeats the draft's FAQ word for word", () => {
    const draft = sampleDraft(data);
    const questions = page.mainEntity as Node[];
    expect(questions.length).toBe(draft.faq.length);
    questions.forEach((q, i) => {
      expect(q["@type"]).toBe("Question");
      expect(q.name).toBe(draft.faq[i].question);
      expect((q.acceptedAnswer as Node).text).toBe(draft.faq[i].answer);
    });
  });

  it("has nothing without a value", () => {
    expect(emptyPaths(jsonld)).toEqual([]);
  });

  it("keeps the place properties off an Organization", () => {
    const withPlace = build(
      withFields(data, {
        geo: field("33.7, -78.9"),
        map_url: field("https://maps.app.goo.gl/abc"),
        area_served: field([{ name: "Myrtle Beach" }]),
        hours: field([{ days: "Monday to Friday", opens: "9 AM", closes: "5 PM" }]),
        price_range: field("from $6 an order"),
      }),
    );
    for (const key of ["geo", "hasMap", "areaServed", "openingHoursSpecification", "priceRange", "image"]) {
      expect(key in withPlace.org, key).toBe(false);
    }
    expect(withPlace.org.address).toEqual(exampleOrg.address);
  });
});

describe("buildJsonLd for a LocalBusiness subtype", () => {
  const data = loadFixture("darcy-bailey");
  const draft: PageDraft = {
    ...sampleDraft(loadFixture("legiit")),
    metaTitle: "About Darcy Bailey & Associates Counselling | Langley, BC",
    metaDescription: "A counselling practice in Langley, BC.",
    title: "About Darcy Bailey & Associates Counselling",
    intro: ["Darcy Bailey & Associates Counselling is a counselling practice in Langley, BC. It has a team of 18."],
    faq: [],
  };
  const { jsonld, org, page } = build(data, draft, "https://darcybaileycounselling.com/", "https://darcybaileycounselling.com/about-us/");

  it("types a MedicalBusiness as a LocalBusiness too", () => {
    expect(org["@type"]).toEqual(["MedicalBusiness", "LocalBusiness"]);
    expect(org["@id"]).toBe("https://darcybaileycounselling.com/#organization");
    expect(org.url).toBe("https://darcybaileycounselling.com/");
    expect(org.image).toBe(org.logo);
  });

  it("has the names, contact details, and description", () => {
    expect(org.name).toBe("Darcy Bailey & Associates Counselling");
    expect(org.legalName).toBe("Darcy Bailey & Associates Counselling Inc.");
    expect(org.alternateName).toEqual(["Darcy Bailey Counselling", "Darcy Bailey and Associates"]);
    expect(org.telephone).toBe("604-533-9163");
    expect(org.email).toBe("info@darcybaileycounselling.com");
    expect(org.description).toBe("Darcy Bailey & Associates Counselling is a counselling practice in Langley, BC.");
  });

  it("has the address, geo, and map", () => {
    expect(org.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "#315, 20385 64 Avenue",
      addressLocality: "Langley",
      addressRegion: "BC",
      postalCode: "V2Y 1N5",
      addressCountry: "CA",
    });
    // geo is a conflict in the fixture: the merged value is used, never a candidate
    expect(org.geo).toEqual({ "@type": "GeoCoordinates", latitude: 49.119401, longitude: -122.6578649 });
    expect(org.hasMap).toBe("https://maps.app.goo.gl/9XSJ3jDrWSiEznJY9");
  });

  it("lists the areas served as City entries", () => {
    expect(org.areaServed).toEqual(
      ["Langley", "Surrey", "Cloverdale", "South Surrey", "Aldergrove", "Abbotsford", "British Columbia"].map((name) => ({
        "@type": "City",
        name,
      })),
    );
  });

  it("writes the opening hours with schema.org day names and 24-hour times", () => {
    expect(org.openingHoursSpecification).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday"], opens: "09:00", closes: "20:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Friday", opens: "09:00", closes: "19:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "09:00", closes: "17:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Sunday", opens: "11:00", closes: "17:00" },
    ]);
  });

  it("has the price range and an offer per pricing item with one amount, in the catalog's currency", () => {
    expect(org.priceRange).toBe("$170 to $195 per 50-minute session");
    const catalog = org.hasOfferCatalog as Node;
    expect(catalog["@type"]).toBe("OfferCatalog");
    const offers = catalog.itemListElement as Node[];
    expect(offers.every((o) => o["@type"] === "Offer")).toBe(true);
    // the notes name CAD on some items, so the whole catalog is CAD, the free consultation included
    expect(offers.map((o) => [o.name, o.price, o.priceCurrency])).toEqual([
      ["Free 15-minute consultation", "0", "CAD"],
      ["Individual counselling, 50 minutes", "170", "CAD"],
      ["Individual counselling with a senior therapist, 50 minutes", "175", "CAD"],
      ["Couples, marriage, or family counselling, 50 minutes", "195", "CAD"],
      ["Individual counselling with a senior therapist, 75 minutes", "262.50", "CAD"],
      ["Couples counselling, 75 minutes", "292.50", "CAD"],
    ]);
  });

  it("has the founder with credentials, the employees, the head count, languages, awards, and memberships", () => {
    expect(org.founder).toEqual([
      {
        "@type": "Person",
        name: "Darcy Bailey",
        jobTitle: "Founder, Owner, and Clinical Director",
        honorificSuffix: "MSW, RSW, RCC, DipAT",
        url: "https://darcybaileycounselling.com/darcy-bailey/",
      },
    ]);
    const employees = people(org.employee);
    expect(employees.length).toBe(17);
    expect(employees[0]).toEqual({
      "@type": "Person",
      name: "Nancy Orlikow",
      jobTitle: "Senior Therapist, Registered Clinical Counsellor",
      honorificSuffix: "MA, RCC, BCATR",
      url: "https://darcybaileycounselling.com/nancy-orlikow/",
    });
    expect(org.numberOfEmployees).toEqual({ "@type": "QuantitativeValue", value: 18 });
    expect(org.knowsLanguage).toEqual(["en", "es"]);
    expect((org.award as string[])[0]).toBe("Canadian Choice Award Winner, Mental Health Services, Langley (2024)");
    expect((org.memberOf as Node[])[0]).toEqual({ "@type": "Organization", name: "BC Association of Clinical Counsellors" });
    expect(org.sameAs).toEqual([
      "https://www.facebook.com/darcybaileycounselling",
      "https://www.instagram.com/dbailey_associatescounselling/",
    ]);
  });

  it("is an AboutPage alone when the draft has no FAQ", () => {
    expect(page["@type"]).toBe("AboutPage");
    expect("mainEntity" in page).toBe(false);
    expect(page["@id"]).toBe("https://darcybaileycounselling.com/about-us/#webpage");
    expect(page.name).toBe("About Darcy Bailey & Associates Counselling | Langley, BC");
    expect(page.description).toBe("A counselling practice in Langley, BC.");
  });

  it("has nothing without a value", () => {
    expect(emptyPaths(jsonld)).toEqual([]);
  });
});

describe("buildJsonLd edge cases", () => {
  const data = loadFixture("legiit");

  it("falls back to Organization for an unknown type and never doubles LocalBusiness", () => {
    expect(build(withFields(data, { business_type: field("Marketplace") })).org["@type"]).toBe("Organization");
    expect(build(withFields(data, { business_type: missing() })).org["@type"]).toBe("Organization");
    expect(build(withFields(data, { business_type: field("LocalBusiness") })).org["@type"]).toBe("LocalBusiness");
    expect(build(withFields(data, { business_type: field("medical business") })).org["@type"]).toEqual([
      "MedicalBusiness",
      "LocalBusiness",
    ]);
  });

  it("reads a founding date written in words, and leaves it out without a year", () => {
    expect(build(withFields(data, { founded_date: field("February 7, 2018") })).org.foundingDate).toBe("2018-02-07");
    expect(build(withFields(data, { founded_date: field("since 2018") })).org.foundingDate).toBe("2018");
    expect("foundingDate" in build(withFields(data, { founded_date: field("over 17 years") })).org).toBe(false);
  });

  it("uses the site when the sheet has no website or logo that can be linked", () => {
    const { org } = build(withFields(data, { website_url: missing(), logo_url: field("javascript:alert(1)") }), undefined, "https://www.legiit.com/");
    expect(org.url).toBe("https://www.legiit.com/");
    expect("logo" in org).toBe(false);
    expect(org["@id"]).toBe("https://www.legiit.com/#organization");
  });

  it("gives a founder the profiles from the social list and their own keys, without the profile page", () => {
    const { org } = build(
      withFields(data, {
        founders: field([
          {
            name: "Ada Example",
            title: "Owner",
            url: "https://example.com/ada",
            linkedin: "https://www.linkedin.com/in/ada/",
            website: "https://example.com/ada",
          },
        ]),
        social_profiles: field([
          { platform: "youtube", url: "https://www.youtube.com/@ada", owner: "Ada Example" },
          { platform: "linkedin", url: "https://linkedin.com/in/ada", owner: "Ada Example" },
          { platform: "x", url: "https://x.com/someoneelse", owner: "Someone Else" },
          { platform: "facebook", url: "https://www.facebook.com/business", owner: "business" },
        ]),
      }),
    );
    expect(org.founder).toEqual([
      {
        "@type": "Person",
        name: "Ada Example",
        jobTitle: "Owner",
        url: "https://example.com/ada",
        sameAs: ["https://www.youtube.com/@ada", "https://linkedin.com/in/ada"],
      },
    ]);
    expect(org.sameAs).toEqual(["https://www.facebook.com/business"]);
  });

  it("leaves out people without a name and an address that is only one line", () => {
    const { org } = build(
      withFields(data, {
        team_members: field([{ name: "", role: "COO" }]),
        headquarters: field({ text: "Somewhere on Main Street" }),
      }),
    );
    expect("employee" in org).toBe(false);
    expect("address" in org).toBe(false);
  });

  it("drops the FAQ entries with no question or answer and the FAQPage type with them", () => {
    const draft = { ...sampleDraft(data), faq: [{ question: "Why?", answer: "" }] };
    const { page } = build(data, draft);
    expect(page["@type"]).toBe("AboutPage");
    expect("mainEntity" in page).toBe(false);
  });

  it("takes the description from the intro's first sentence, else the meta description", () => {
    const draft = { ...sampleDraft(data), intro: ["Legiit Inc. is a marketplace. It launched in 2018."] };
    expect(build(data, draft).org.description).toBe("Legiit Inc. is a marketplace.");
    const noIntro = { ...sampleDraft(data), intro: [], metaDescription: "From the meta description." };
    expect(build(data, noIntro).org.description).toBe("From the meta description.");
  });
});

describe("the small parsers", () => {
  it("siteOrigin", () => {
    expect(siteOrigin("https://www.legiit.com/about/")).toBe("https://www.legiit.com");
    expect(siteOrigin("legiit.com")).toBe("https://legiit.com");
    expect(siteOrigin("http://localhost:3000/x")).toBe("http://localhost:3000");
  });

  it("orgType and isLocalBusinessType", () => {
    expect(orgType(ABOUT_V1, "Organization")).toBe("Organization");
    expect(orgType(ABOUT_V1, "ProfessionalService")).toEqual(["ProfessionalService", "LocalBusiness"]);
    expect(orgType(ABOUT_V1, "EducationalOrganization")).toBe("EducationalOrganization");
    expect(isLocalBusinessType(ABOUT_V1, "EducationalOrganization")).toBe(false);
    expect(isLocalBusinessType(ABOUT_V1, "Dentist")).toBe(true);
    expect(isLocalBusinessType(ABOUT_V1, "")).toBe(false);
  });

  it("firstSentence stops at the first full stop that ends a sentence", () => {
    expect(firstSentence("Legiit Inc. is a marketplace. It launched in 2018.")).toBe("Legiit Inc. is a marketplace.");
    expect(firstSentence("Chris M. Walker founded it. Then more.")).toBe("Chris M. Walker founded it.");
    expect(firstSentence("Prices start at $262.50 per session. More.")).toBe("Prices start at $262.50 per session.");
    expect(firstSentence("Visit chrismwalker.io for more. Next.")).toBe("Visit chrismwalker.io for more.");
    expect(firstSentence('He said "no." Then left.')).toBe('He said "no."');
    expect(firstSentence("Serving the U.S. and Canada. Next.")).toBe("Serving the U.S. and Canada.");
    expect(firstSentence("Is it open? Yes.")).toBe("Is it open?");
    expect(firstSentence("One sentence only")).toBe("One sentence only");
    expect(firstSentence("  spaced   out.  ")).toBe("spaced out.");
    expect(firstSentence("")).toBe("");
  });

  it("isoDate", () => {
    expect(isoDate("2018-02-07")).toBe("2018-02-07");
    expect(isoDate("2018-02")).toBe("2018-02");
    expect(isoDate("2018")).toBe("2018");
    expect(isoDate("February 7, 2018")).toBe("2018-02-07");
    expect(isoDate("7 Feb 2018")).toBe("2018-02-07");
    expect(isoDate("February 2018")).toBe("2018-02");
    expect(isoDate("since 2018")).toBe("2018");
    expect(isoDate("2018-02-07T00:00:00Z")).toBe("2018-02-07");
    // two readings of a numeric date: only the year is certain
    expect(isoDate("03/07/2018")).toBe("2018");
    expect(isoDate("over 17 years")).toBeNull();
    expect(isoDate("")).toBeNull();
  });

  it("teamCount", () => {
    expect(teamCount("45 people across six continents")).toBe(45);
    expect(teamCount("14 registered therapists, one clinical director, and three client care staff (18 people)")).toBe(18);
    expect(teamCount("a team of 12")).toBe(12);
    expect(teamCount("1,200 employees")).toBe(1200);
    expect(teamCount("two office staff")).toBeNull();
    expect(teamCount("")).toBeNull();
  });

  it("geoCoordinates", () => {
    expect(geoCoordinates("49.119401, -122.6578649")).toEqual({ latitude: 49.119401, longitude: -122.6578649 });
    expect(geoCoordinates("49.1 -122.6")).toEqual({ latitude: 49.1, longitude: -122.6 });
    expect(geoCoordinates("200, 10")).toBeNull();
    expect(geoCoordinates("lat 49")).toBeNull();
    expect(geoCoordinates("")).toBeNull();
  });

  it("parsePrice takes the one amount a price states", () => {
    expect(parsePrice("$47 a month")).toBe("47");
    expect(parsePrice("$262.50")).toBe("262.50");
    expect(parsePrice("$1,200")).toBe("1200");
    expect(parsePrice("$0")).toBe("0");
    expect(parsePrice("Free")).toBe("0");
    expect(parsePrice("Free 15-minute consultation")).toBe("0");
    expect(parsePrice("$170 per 50-minute session")).toBe("170");
    expect(parsePrice("$170 + GST")).toBe("170");
    expect(parsePrice("170 per session")).toBe("170");
    expect(parsePrice("CAD 170")).toBe("170");
    expect(parsePrice("from $6, average order about $90")).toBeNull();
    expect(parsePrice("$170 to $195")).toBeNull();
    expect(parsePrice("call for a quote")).toBeNull();
    expect(parsePrice("")).toBeNull();
  });

  it("currencyCode and currencySymbol", () => {
    expect(currencyCode("$170", "CAD; GST question open")).toBe("CAD");
    expect(currencyCode("170 eur")).toBe("EUR");
    expect(currencyCode("$170", "no code here")).toBeNull();
    expect(currencySymbol("$170")).toBe("USD");
    expect(currencySymbol("C$170")).toBe("CAD");
    expect(currencySymbol("CA$170")).toBe("CAD");
    expect(currencySymbol("A$170")).toBe("AUD");
    expect(currencySymbol("£170")).toBe("GBP");
    expect(currencySymbol("€170")).toBe("EUR");
    expect(currencySymbol("170")).toBeNull();
  });

  it("openingHours reads days and times as pages write them", () => {
    expect(
      openingHours([
        { days: "Mon - Fri", opens: "9", closes: "5" },
        { days: "weekends", opens: "10:00", closes: "16:00" },
        { days: "Sunday", opens: "Closed", closes: "" },
        { days: "by appointment", opens: "9 AM", closes: "5 PM" },
        { days: "daily", opens: "noon", closes: "midnight" },
      ]),
    ).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "09:00", closes: "17:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Saturday", "Sunday"], opens: "10:00", closes: "16:00" },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        opens: "12:00",
        closes: "00:00",
      },
    ]);
  });

  it("languageCode", () => {
    expect(languageCode("English")).toBe("en");
    expect(languageCode("punjabi")).toBe("pa");
    expect(languageCode("Klingon")).toBe("Klingon");
  });

  it("prune removes everything without a value and keeps zero", () => {
    expect(prune({ a: "", b: [], c: {}, d: null, e: undefined, f: [{ g: "" }], h: 0, i: "x", j: [1, "", null] })).toEqual({
      h: 0,
      i: "x",
      j: [1],
    });
    expect(prune({ a: { b: { c: "" } } })).toBeUndefined();
  });
});
