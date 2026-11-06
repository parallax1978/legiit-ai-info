import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Json, PlatformT } from "@/lib/db/types";
import type { FactSheetData } from "@/lib/facts/types";
import {
  buildInstructions,
  compareExistingSchema,
  factContactOf,
  pagePath,
  sameAddress,
  schemaNoteLines,
  type ExistingSchemaBlock,
} from "./instructions";
import type { InstructionsInput } from "./types";

function loadFixture(name: "legiit" | "darcy-bailey"): FactSheetData {
  const file = path.join(process.cwd(), "examples", "fixtures", `${name}.factsheet.json`);
  return JSON.parse(readFileSync(file, "utf8")) as FactSheetData;
}

const legiit = loadFixture("legiit");
const darcy = loadFixture("darcy-bailey");

const PLATFORMS: PlatformT[] = ["wordpress", "shopify", "wix", "squarespace", "webflow", "other", "unknown"];

/** Every @type in the block, the way the crawler fills JsonLdBlock.types. */
function collectTypes(data: Json, out: string[] = []): string[] {
  if (data === null || typeof data !== "object") return out;
  if (Array.isArray(data)) {
    for (const item of data) collectTypes(item, out);
    return out;
  }
  const t = data["@type"];
  const found = typeof t === "string" ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
  for (const name of found) if (!out.includes(name)) out.push(name);
  for (const [key, value] of Object.entries(data)) {
    if (key !== "@type" && value !== undefined) collectTypes(value, out);
  }
  return out;
}

function block(data: Json, url = "https://legiit.com/"): ExistingSchemaBlock {
  return { data, raw: JSON.stringify(data), types: collectTypes(data), url };
}

function input(partial: Partial<InstructionsInput> = {}): InstructionsInput {
  return {
    platform: "wordpress",
    companyName: "Legiit",
    existingSchema: [],
    data: legiit,
    pageUrl: "https://legiit.com/about",
    ...partial,
  };
}

/** The organization node from examples/legiit-schema.html, as a site might already carry it. */
const LEGIIT_ORG: Json = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://legiit.com/#organization",
  name: "Legiit",
  url: "https://legiit.com",
  logo: "https://legiit.com/frontend/images/project_image/logos/Legiit_Logo_LightBG.png",
  address: {
    "@type": "PostalAddress",
    streetAddress: "2411 N. Oak Street 105E",
    addressLocality: "Myrtle Beach",
    addressRegion: "SC",
    postalCode: "29577",
    addressCountry: "US",
  },
  sameAs: [
    "https://www.youtube.com/@LegiitOfficial",
    "https://www.linkedin.com/company/legiit",
    "https://x.com/legiitcom",
    "https://www.facebook.com/legiitofficial",
  ],
};

/** A block that disagrees with the Legiit fact sheet on most of what it states. */
const LEGIIT_WRONG: Json = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Legiit Marketplace",
  url: "https://www.legiit.com/",
  telephone: "+1 843 555 0100",
  address: {
    "@type": "PostalAddress",
    streetAddress: "100 Ocean Blvd",
    addressLocality: "Myrtle Beach",
    addressRegion: "SC",
    postalCode: "29577",
  },
  sameAs: ["https://www.youtube.com/@LegiitOfficial", "https://x.com/cmwalker"],
};

/** The organization node from examples/darcy-bailey-schema.html, written the way a site writes it. */
const DARCY_ORG: Json = {
  "@context": "https://schema.org",
  "@type": ["MedicalBusiness", "LocalBusiness"],
  "@id": "https://darcybaileycounselling.com/#organization",
  name: "Darcy Bailey & Associates Counselling",
  legalName: "Darcy Bailey & Associates Counselling Inc.",
  url: "https://darcybaileycounselling.com/",
  telephone: "+1-604-533-9163",
  email: "info@darcybaileycounselling.com",
  address: {
    "@type": "PostalAddress",
    streetAddress: "#315, 20385 64 Avenue",
    addressLocality: "Langley",
    addressRegion: "BC",
    postalCode: "V2Y 1N5",
    addressCountry: "CA",
  },
  sameAs: ["https://www.facebook.com/darcybaileycounselling", "https://www.instagram.com/dbailey_associatescounselling/"],
};

const BANNED_SAMPLE = [
  "leverage",
  "cutting-edge",
  "seamless",
  "unlock",
  "empower",
  "robust",
  "innovative",
  "passionate",
  "journey",
  "bespoke",
  "streamline",
  "effortless",
  "comprehensive solution",
  "one-stop shop",
  "look no further",
];

function expectHouseStyle(md: string): void {
  expect(md).not.toMatch(/[–—]/);
  expect(md).not.toContain("!");
  for (const word of BANNED_SAMPLE) expect(md.toLowerCase()).not.toContain(word);
  // Instructions address the reader; the product never says "we".
  expect(md).not.toMatch(/\bwe\b/i);
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

describe("buildInstructions", () => {
  it("opens with the company, lists the five files, and names the page URL", () => {
    const md = buildInstructions(input());
    expect(md.startsWith("# Install the About page for Legiit\n")).toBe(true);
    for (const file of ["about.html", "about-wordpress.html", "schema.json", "instructions.md", "fact-sheet.json"]) {
      expect(md).toContain(`\`${file}\``);
    }
    expect(md).toContain("https://legiit.com/about");
    expect(md).toContain('<script type="application/ld+json">');
    expect(md.endsWith("\n")).toBe(true);
  });

  it("has the sections in order", () => {
    const md = buildInstructions(input());
    const headings = md.split("\n").filter((l) => l.startsWith("## "));
    expect(headings).toEqual([
      "## What is in the download",
      "## Steps for WordPress",
      "## The schema already on the site",
      "## How to check",
      "## Keep the page true",
    ]);
  });

  it("points at the Rich Results Test and the Schema Markup Validator", () => {
    const md = buildInstructions(input());
    expect(md).toContain("[Rich Results Test](https://search.google.com/test/rich-results)");
    expect(md).toContain("[Schema Markup Validator](https://validator.schema.org/)");
    expect(md).toContain("change it here too");
  });

  it.each(PLATFORMS)("%s says where the HTML goes and where the JSON-LD goes", (platform) => {
    const md = buildInstructions(input({ platform }));
    // The HTML: the article file and a named place for it.
    expect(md).toContain("`about-wordpress.html`");
    // The JSON-LD: the schema file, and what to do when the editor strips script tags.
    expect(md).toContain("`schema.json`");
    expect(md).toMatch(/strips? script/i);
    expectHouseStyle(md);

    const anchors: Record<PlatformT, RegExp[]> = {
      wordpress: [/Custom HTML block/, /Rank Math|Yoast|WPCode/, /page template|Template/],
      shopify: [/Show HTML/, /Custom Liquid/, /\/pages\/about/],
      wix: [/Embed HTML/, /Velo/, /Structured data markup/],
      squarespace: [/Code block/, /Code Injection/],
      webflow: [/Embed element/, /Inside <head> tag/],
      other: [/`about\.html`/, /head/],
      unknown: [/could not tell which platform/, /WordPress:/, /Shopify:/, /Wix:/, /Squarespace:/, /Webflow:/],
    };
    for (const re of anchors[platform]) expect(md).toMatch(re);
  });

  it("names the platform in its heading", () => {
    expect(buildInstructions(input({ platform: "shopify" }))).toContain("## Steps for Shopify");
    expect(buildInstructions(input({ platform: "other" }))).toContain("## Steps for a custom site");
    expect(buildInstructions(input({ platform: "unknown" }))).toContain("## Steps for your site");
  });

  it("tells a Shopify owner the page lives under /pages/ and what to do about it", () => {
    const md = buildInstructions(input({ platform: "shopify", pageUrl: "https://acme-roofing.example/about" }));
    expect(md).toContain("https://acme-roofing.example/pages/about");
    expect(md).toContain("redirect from /about to /pages/about");
  });

  it("falls back to plain words without a company name or a page URL", () => {
    const md = buildInstructions(input({ companyName: "  ", pageUrl: "" }));
    expect(md.startsWith("# Install the About page for the business\n")).toBe(true);
    expect(md).toContain("The page goes at /about.");
  });

  it("reads as plain prose for both fixtures", () => {
    expectHouseStyle(buildInstructions(input({ existingSchema: [block(LEGIIT_WRONG), block(LEGIIT_ORG, "https://legiit.com/about")] })));
    expectHouseStyle(
      buildInstructions(
        input({
          companyName: "Darcy Bailey & Associates Counselling",
          data: darcy,
          platform: "wordpress",
          pageUrl: "https://darcybaileycounselling.com/about",
          existingSchema: [block(DARCY_ORG, "https://darcybaileycounselling.com/")],
        }),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// The fact sheet's side
// ---------------------------------------------------------------------------

describe("factContactOf", () => {
  it("takes the business's own profiles for sameAs and keeps people's profiles apart", () => {
    const fact = factContactOf(legiit, "Legiit");
    expect(fact.name).toBe("Legiit");
    expect(fact.url).toBe("https://legiit.com");
    expect(fact.telephone).toBe("");
    expect(fact.email).toBe("");
    expect(fact.address?.addressLocality).toBe("Myrtle Beach");
    expect(fact.sameAs).toEqual([
      "https://www.youtube.com/@LegiitOfficial",
      "https://www.linkedin.com/company/legiit",
      "https://x.com/legiitcom",
      "https://www.facebook.com/legiitofficial",
    ]);
    expect(fact.personProfiles.find((p) => p.url === "https://x.com/cmwalker")?.owner).toBe("Chris M. Walker");
  });

  it("uses the merged value of a conflict, never a candidate, and reads the legal and alternate names", () => {
    const fact = factContactOf(darcy, "ignored when the sheet has a name");
    expect(fact.name).toBe("Darcy Bailey & Associates Counselling");
    expect(fact.legalName).toBe("Darcy Bailey & Associates Counselling Inc.");
    expect(fact.alternateNames).toEqual(["Darcy Bailey Counselling", "Darcy Bailey and Associates"]);
    expect(fact.telephone).toBe("604-533-9163");
    expect(fact.email).toBe("info@darcybaileycounselling.com");
  });

  it("falls back to the given company name when the sheet has none", () => {
    const empty: FactSheetData = { templateId: "about-v1", fields: {} };
    expect(factContactOf(empty, "Acme Roofing").name).toBe("Acme Roofing");
    expect(factContactOf(empty, "Acme Roofing").address).toBeNull();
  });
});

describe("sameAddress", () => {
  const fact = {
    streetAddress: "2411 N. Oak Street 105E",
    addressLocality: "Myrtle Beach",
    addressRegion: "SC",
    postalCode: "29577",
    addressCountry: "US",
    text: "2411 N. Oak Street 105E, Myrtle Beach, SC 29577, USA",
  };

  it("matches parts against parts, with or without the country", () => {
    expect(sameAddress({ streetAddress: "2411 N. Oak Street 105E", addressLocality: "Myrtle Beach", addressRegion: "SC", postalCode: "29577" }, fact)).toBe(true);
    expect(sameAddress({ streetAddress: "100 Ocean Blvd", addressLocality: "Myrtle Beach", addressRegion: "SC", postalCode: "29577" }, fact)).toBe(false);
  });

  it("matches a one-line address against the parts, ignoring a trailing country", () => {
    expect(sameAddress("2411 N. Oak Street 105E, Myrtle Beach, SC 29577", fact)).toBe(true);
    expect(sameAddress("2411 N. Oak Street 105E, Myrtle Beach, SC 29577, USA", fact)).toBe(true);
    expect(sameAddress("1200 Main Street, Dayton, OH 45402", fact)).toBe(false);
  });
});

describe("pagePath", () => {
  it("is / for the home page and the decoded path without a trailing slash otherwise", () => {
    expect(pagePath("https://legiit.com/")).toBe("/");
    expect(pagePath("https://legiit.com")).toBe("/");
    expect(pagePath("https://legiit.com/contact/")).toBe("/contact");
    expect(pagePath("https://legiit.com/caf%C3%A9?utm=1#x")).toBe("/café");
    expect(pagePath(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Comparing the site's schema with the fact sheet
// ---------------------------------------------------------------------------

describe("compareExistingSchema", () => {
  it("reports every disagreement of a block that contradicts the fact sheet", () => {
    const [report] = compareExistingSchema([block(LEGIIT_WRONG)], legiit, "Legiit");
    expect(report.kind).toBe("organization");
    expect(report.types).toEqual(["Organization"]);
    expect(report.pages).toEqual(["/"]);

    const byProperty = new Map(report.disagreements.map((d) => [d.property, d]));
    expect([...byProperty.keys()].sort()).toEqual(["address", "name", "sameAs"]);
    expect(byProperty.get("name")).toMatchObject({ site: "Legiit Marketplace", fact: "Legiit" });
    expect(byProperty.get("address")?.site).toBe("100 Ocean Blvd, Myrtle Beach, SC 29577");
    expect(byProperty.get("address")?.fact).toBe("2411 N. Oak Street 105E, Myrtle Beach, SC 29577, US");
    expect(byProperty.get("sameAs")?.site).toBe("https://x.com/cmwalker");
    expect(byProperty.get("sameAs")?.note).toContain("Chris M. Walker");

    // www and the trailing slash do not make a different web address.
    expect(report.agreements).toEqual(["url"]);
    // The fact sheet has no phone, so the site's phone is a gap, not a contradiction.
    expect(report.gaps).toEqual([{ property: "telephone", site: "+1 843 555 0100" }]);
  });

  it("reports a block that agrees as agreeing on every property it states", () => {
    const [report] = compareExistingSchema([block(DARCY_ORG, "https://darcybaileycounselling.com/")], darcy, "Darcy Bailey & Associates Counselling");
    expect(report.kind).toBe("organization");
    expect(report.types).toEqual(["MedicalBusiness", "LocalBusiness"]);
    expect(report.disagreements).toEqual([]);
    expect(report.gaps).toEqual([]);
    expect([...report.agreements].sort()).toEqual(["address", "email", "name", "sameAs", "telephone", "url"]);
  });

  it("treats a phone with a country code, a URL with a trailing slash, and an ampersand written as and as the same", () => {
    const [report] = compareExistingSchema(
      [block({ ...(DARCY_ORG as Record<string, Json>), name: "Darcy Bailey and Associates Counselling", telephone: "(604) 533-9163", url: "http://www.darcybaileycounselling.com" })],
      darcy,
      "Darcy Bailey & Associates Counselling",
    );
    expect(report.disagreements).toEqual([]);
    expect(report.agreements).toContain("name");
    expect(report.agreements).toContain("telephone");
    expect(report.agreements).toContain("url");
  });

  it("notes when the site's name is the fact sheet's legal name or an alternate name", () => {
    const legal = compareExistingSchema(
      [block({ "@type": "Organization", name: "Darcy Bailey & Associates Counselling Inc." })],
      darcy,
      "Darcy Bailey & Associates Counselling",
    )[0];
    expect(legal.disagreements[0]).toMatchObject({ property: "name", site: "Darcy Bailey & Associates Counselling Inc." });
    expect(legal.disagreements[0].note).toContain("legal name");

    const alternate = compareExistingSchema(
      [block({ "@type": "Organization", name: "Darcy Bailey Counselling" })],
      darcy,
      "Darcy Bailey & Associates Counselling",
    )[0];
    expect(alternate.disagreements[0].note).toContain("alternate name");
  });

  it("reads the organization out of a Yoast-style @graph, once, however many pages carry it", () => {
    const graph = (page: string): Json => ({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", "@id": "https://legiit.com/#website", name: "Legiit", url: "https://legiit.com/" },
        { "@type": "WebPage", "@id": `https://legiit.com${page}#webpage`, name: `Page ${page}`, isPartOf: { "@id": "https://legiit.com/#website" } },
        { "@type": "Organization", "@id": "https://legiit.com/#organization", name: "Legiit Marketplace", url: "https://legiit.com/" },
      ],
    });
    const reports = compareExistingSchema(
      [block(graph("/"), "https://legiit.com/"), block(graph("/pricing/"), "https://legiit.com/pricing/"), block(graph("/about/"), "https://legiit.com/about/")],
      legiit,
      "Legiit",
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].kind).toBe("organization");
    expect(reports[0].pages).toEqual(["/", "/pricing", "/about"]);
    expect(reports[0].disagreements.map((d) => d.property)).toEqual(["name"]);
    // The WebSite node also says name "Legiit", but a WebSite is not the business.
    expect(reports[0].agreements).toEqual(["url"]);
  });

  it("compares a publisher nested in an article, and ignores a person's phone", () => {
    const article: Json = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "A post",
      author: { "@type": "Person", name: "Chris M. Walker", telephone: "+1 843 555 0199" },
      publisher: { "@type": "Organization", name: "Legiit Marketplace", logo: { "@type": "ImageObject", url: "https://legiit.com/logo.png" } },
    };
    const reports = compareExistingSchema([block(article, "https://legiit.com/blog/a-post/")], legiit, "Legiit");
    expect(reports).toHaveLength(1);
    expect(reports[0].kind).toBe("organization");
    expect(reports[0].disagreements).toEqual([{ property: "name", site: "Legiit Marketplace", fact: "Legiit" }]);
    expect(reports[0].gaps).toEqual([]);
  });

  it("files blocks about pages, posts, and people under other", () => {
    const reports = compareExistingSchema(
      [
        block({ "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home" }] }),
        block({ "@type": "WebSite", name: "Legiit", url: "https://legiit.com/" }),
        block({ "@type": "Person", name: "Chris M. Walker", sameAs: ["https://x.com/cmwalker"] }, "https://legiit.com/team/"),
      ],
      legiit,
      "Legiit",
    );
    expect(reports.map((r) => r.kind)).toEqual(["other", "other", "other"]);
    expect(reports.map((r) => r.types[0])).toEqual(["BreadcrumbList", "WebSite", "Person"]);
  });

  it("reports a block that did not parse", () => {
    const broken: ExistingSchemaBlock = { data: null, raw: "{ not json", types: [], error: "Unexpected token n", url: "https://legiit.com/contact/" };
    const [report] = compareExistingSchema([broken], legiit, "Legiit");
    expect(report).toMatchObject({ kind: "broken", pages: ["/contact"], error: "Unexpected token n" });
  });

  it("takes a RoofingContractor with a telephone and a one-line address as the business", () => {
    const sheet: FactSheetData = {
      templateId: "about-v1",
      fields: {
        company_name: { value: "Acme Roofing", status: "found", evidence: [] },
        phone: { value: "(937) 555-0199", status: "found", evidence: [] },
        headquarters: { value: { text: "1200 Main Street, Dayton, OH 45402" }, status: "found", evidence: [] },
      },
    };
    const site: Json = {
      "@context": "https://schema.org",
      "@type": "RoofingContractor",
      name: "Acme Roofing",
      telephone: "+1-937-555-0142",
      address: { "@type": "PostalAddress", streetAddress: "1200 Main Street", addressLocality: "Dayton", addressRegion: "OH", postalCode: "45402", addressCountry: "US" },
    };
    const [report] = compareExistingSchema([block(site, "https://acme-roofing.example/")], sheet, "Acme Roofing");
    expect(report.kind).toBe("organization");
    expect(report.agreements).toEqual(["name", "address"]);
    expect(report.disagreements).toEqual([{ property: "telephone", site: "+1-937-555-0142", fact: "(937) 555-0199" }]);
  });

  it("is empty without schema and tolerant of junk", () => {
    expect(compareExistingSchema([], legiit, "Legiit")).toEqual([]);
    const odd = [{ data: "just a string", raw: '"just a string"', types: [] }, { data: 42, raw: "42", types: [] }, { data: [], raw: "[]", types: [] }];
    expect(compareExistingSchema(odd, legiit, "Legiit").map((r) => r.kind)).toEqual(["other", "other", "other"]);
  });
});

// ---------------------------------------------------------------------------
// The notes as a person reads them
// ---------------------------------------------------------------------------

describe("schemaNoteLines", () => {
  it("writes one line per disagreement with both values and what to do", () => {
    const lines = schemaNoteLines([block(LEGIIT_WRONG)], legiit, "Legiit");
    const name = lines.find((l) => l.includes('"Legiit Marketplace"'));
    expect(name).toBeDefined();
    expect(name).toContain("The Organization block on the home page");
    expect(name).toContain('the fact sheet says "Legiit"');
    expect(name).toMatch(/remove/i);
    expect(name).toMatch(/do not contradict/);

    const address = lines.find((l) => l.includes("100 Ocean Blvd"));
    expect(address).toContain("2411 N. Oak Street 105E");

    const sameAs = lines.find((l) => l.includes("https://x.com/cmwalker"));
    expect(sameAs).toContain("Chris M. Walker");
    expect(sameAs).toMatch(/Remove those links/);

    // The site's phone is offered as something to add, not as a contradiction.
    const phone = lines.find((l) => l.includes("+1 843 555 0100"));
    expect(phone).toContain("does not have");
    expect(phone).not.toContain("contradict");
  });

  it("writes one line for a block that agrees", () => {
    const lines = schemaNoteLines([block(DARCY_ORG, "https://darcybaileycounselling.com/")], darcy, "Darcy Bailey & Associates Counselling");
    const note = lines.filter((l) => l.startsWith("- "));
    expect(note).toHaveLength(1);
    expect(note[0]).toContain("The MedicalBusiness block on the home page agrees with the fact sheet");
    expect(note[0]).toContain("can stay");
    expect(note[0]).toContain("name");
    expect(note[0]).toContain("phone number");
    expect(note[0]).toContain("address");
  });

  it("counts the other pages a repeated block appears on", () => {
    const lines = schemaNoteLines(
      [block(LEGIIT_ORG, "https://legiit.com/"), block(LEGIIT_ORG, "https://legiit.com/pricing/"), block(LEGIIT_ORG, "https://legiit.com/about/")],
      legiit,
      "Legiit",
    );
    const note = lines.filter((l) => l.startsWith("- "));
    expect(note).toHaveLength(1);
    expect(note[0]).toContain("on the home page and 2 other pages");
    expect(note[0]).toContain("can stay");
  });

  it("sums up the blocks about pages and flags a broken one", () => {
    const broken: ExistingSchemaBlock = { data: null, raw: "{ not json", types: [], error: "Unexpected token n", url: "https://legiit.com/contact/" };
    const lines = schemaNoteLines(
      [block({ "@type": "BreadcrumbList" }), block({ "@type": "WebSite", name: "Legiit" }, "https://legiit.com/about/"), broken],
      legiit,
      "Legiit",
    );
    expect(lines.find((l) => l.includes("did not parse"))).toContain("`/contact`");
    const other = lines.find((l) => l.includes("rather than the business"));
    expect(other).toContain("BreadcrumbList and WebSite blocks");
    expect(other).toContain("can stay");
  });

  it("says so when the site has no JSON-LD", () => {
    const lines = schemaNoteLines([], legiit, "Legiit");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("no JSON-LD");
  });

  it("lands in the document under its heading", () => {
    const md = buildInstructions(input({ existingSchema: [block(LEGIIT_WRONG)] }));
    const section = md.split("## The schema already on the site")[1].split("## How to check")[0];
    expect(section).toContain('"Legiit Marketplace"');
    expect(section).toContain("100 Ocean Blvd");
  });
});
