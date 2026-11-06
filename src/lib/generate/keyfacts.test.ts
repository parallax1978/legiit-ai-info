import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FactField, FactSheetData, FactStatus, FactValue } from "@/lib/facts/types";
import { ABOUT_V1 } from "@/templates/about-v1";
import type { TemplateSpec } from "@/templates/types";
import {
  awardLabel,
  cleanItems,
  fieldList,
  fieldText,
  fieldValue,
  formatDate,
  isBusinessOwner,
  keyFactsRows,
  socialLabel,
} from "./keyfacts";
import type { KeyFactRow } from "./types";

function loadFixture(name: "legiit" | "darcy-bailey"): FactSheetData {
  const file = path.join(process.cwd(), "examples", "fixtures", `${name}.factsheet.json`);
  return JSON.parse(readFileSync(file, "utf8")) as FactSheetData;
}

/** A deep copy with some fields replaced, so a test can change the sheet without touching the others. */
function withFields(data: FactSheetData, fields: Record<string, FactField>): FactSheetData {
  const copy = JSON.parse(JSON.stringify(data)) as FactSheetData;
  Object.assign(copy.fields, fields);
  return copy;
}

function field(value: FactValue, status: FactStatus = "found"): FactField {
  return { value, status, evidence: [] };
}

const missing = (): FactField => field(null, "missing");

function byLabel(rows: KeyFactRow[]): Map<string, KeyFactRow> {
  return new Map(rows.map((r) => [r.label, r]));
}

function row(rows: KeyFactRow[], label: string): KeyFactRow {
  const r = byLabel(rows).get(label);
  expect(r, `no row "${label}"`).toBeDefined();
  return r as KeyFactRow;
}

describe("keyFactsRows with the Legiit fixture", () => {
  const data = loadFixture("legiit");
  const rows = keyFactsRows(ABOUT_V1, data);

  it("has one row per key facts row that has a value, in template order", () => {
    expect(rows.map((r) => r.label)).toEqual([
      "Company Name",
      "Type",
      "Founded",
      "Founder",
      "Headquarters",
      "Website",
      "Core Offering",
      "Pricing",
      "Contract Terms",
      "Services",
      "Communication",
      "Notable Clients",
      "Customers Served",
      "Projects Delivered",
      "Competitors",
      "Social",
    ]);
  });

  it("takes the first field in `from` that has a value", () => {
    expect(row(rows, "Company Name").text).toBe("Legiit");
    expect(row(rows, "Type").text).toBe("curated freelance marketplace");
    // founded_date wins over years_in_business; legal_name stands in when the company name is missing
    expect(row(rows, "Founded").text).toBe("February 7, 2018");
    const legalOnly = keyFactsRows(
      ABOUT_V1,
      withFields(data, { company_name: missing(), legal_name: field("Legiit Inc.") }),
    );
    expect(row(legalOnly, "Company Name").text).toBe("Legiit Inc.");
  });

  it("joins people as name and title with semicolons", () => {
    const founder = row(rows, "Founder");
    expect(founder.text).toBe("Chris M. Walker, Founder and CEO; Jim Sabellico, Co-founder and CTO");
    expect(founder.html).toBe(founder.text);
  });

  it("writes pricing items as name: price (notes), one sentence each", () => {
    const pricing = row(rows, "Pricing").text;
    expect(pricing.startsWith("Account: Free (Creating an account is free). ")).toBe(true);
    expect(pricing).toContain(
      "Marketplace orders: from $6, average order about $90 (largest buyers spend up to $30,000 a month). ",
    );
    expect(pricing).toContain("Legiit Leads Starter: $47 a month (50 searches; first 7 days free; two months free on annual). ");
    expect(pricing.endsWith("Seller Plus: $27 a month (subscription for freelancers who sell on the platform)")).toBe(true);
  });

  it("lists services by name and links the ones with a page", () => {
    const services = row(rows, "Services");
    expect(services.text).toBe("The marketplace, Command Center, Legiit Leads, Seller Plus and advertising for freelancers");
    expect(services.html).toBe(
      '<a href="https://legiit.com">The marketplace</a>, Command Center, Legiit Leads, Seller Plus and advertising for freelancers',
    );
  });

  it("groups social profiles by owner, the business first, as links", () => {
    const social = row(rows, "Social");
    expect(social.text).toBe(
      "Legiit: YouTube, LinkedIn, X, Facebook. Chris M. Walker: YouTube, Instagram, LinkedIn, X, Facebook, chrismwalker.io. Jim Sabellico: LinkedIn",
    );
    expect(social.html.startsWith('Legiit: <a href="https://www.youtube.com/@LegiitOfficial">YouTube</a>, ')).toBe(true);
    expect(social.html).toContain(
      'Chris M. Walker: <a href="https://www.youtube.com/@ChrisMWalker">YouTube</a>, <a href="https://www.instagram.com/cmwlegiit/">Instagram</a>',
    );
    expect(social.html).toContain('<a href="https://chrismwalker.io">chrismwalker.io</a>');
    expect(social.html.endsWith('Jim Sabellico: <a href="https://www.linkedin.com/in/jimsabellico/">LinkedIn</a>')).toBe(true);
  });

  it("leaves the owner label off when only the business has profiles", () => {
    const social = row(keyFactsRows(ABOUT_V1, loadFixture("darcy-bailey")), "Social");
    expect(social.text).toBe("Facebook, Instagram");
    expect(social.html).toBe(
      '<a href="https://www.facebook.com/darcybaileycounselling">Facebook</a>, <a href="https://www.instagram.com/dbailey_associatescounselling/">Instagram</a>',
    );
  });

  it("puts an address on one line", () => {
    expect(row(rows, "Headquarters").text).toBe("2411 N. Oak Street 105E, Myrtle Beach, SC 29577, US");
  });

  it("renders the website as a link labelled with its host", () => {
    const website = row(rows, "Website");
    expect(website.text).toBe("legiit.com");
    expect(website.html).toBe('<a href="https://legiit.com">legiit.com</a>');
  });

  it("joins plain lists with commas, or semicolons once an item has a comma of its own", () => {
    expect(row(rows, "Notable Clients").text).toBe("Superstar SEO, No Half Cakes, 38 Digital Market, Craig Campbell SEO");
    expect(row(rows, "Competitors").text).toBe("Fiverr, Upwork, Traditional marketing and SEO agencies on retainer");
    expect(row(rows, "Communication").text).toBe(
      "Human customer success team, 24/7; Direct messaging with your freelancer inside each order",
    );
  });

  it("keeps text values as they are", () => {
    expect(row(rows, "Customers Served").text).toBe("Tens of thousands of buyers. 25,000+ freelancers");
    expect(row(rows, "Contract Terms").text).toBe(
      "None on the marketplace. Pay per order, no retainer. Legiit Leads (monthly or annual) and Seller Plus are subscriptions",
    );
  });

  it("leaves out rows with nothing", () => {
    const thin = keyFactsRows(
      ABOUT_V1,
      withFields(data, {
        pricing: missing(),
        price_range: missing(),
        free_offer: missing(),
        notable_clients: field([], "found"),
        competitors: field([{ name: "" }], "found"),
      }),
    );
    const labels = thin.map((r) => r.label);
    expect(labels).not.toContain("Pricing");
    expect(labels).not.toContain("Notable Clients");
    expect(labels).not.toContain("Competitors");
    expect(labels).toContain("Company Name");
  });

  it("falls through to the next field when the first is empty", () => {
    const fallback = keyFactsRows(ABOUT_V1, withFields(data, { pricing: missing() }));
    expect(row(fallback, "Pricing").text).toBe("Free to join. Services from $6. Average order about $90.");
  });

  it("uses the merged value of a conflict, never a candidate", () => {
    const conflicted = keyFactsRows(
      ABOUT_V1,
      withFields(data, {
        category: {
          value: "curated freelance marketplace",
          status: "conflict",
          evidence: [],
          candidates: [
            { value: "curated freelance marketplace", evidence: [] },
            { value: "freelance platform", evidence: [] },
          ],
        },
      }),
    );
    expect(row(conflicted, "Type").text).toBe("curated freelance marketplace");
  });
});

describe("keyFactsRows escaping and safety", () => {
  const data = loadFixture("legiit");

  it("escapes HTML in cells and keeps the text plain", () => {
    const rows = keyFactsRows(ABOUT_V1, withFields(data, { company_name: field('Smith & Sons <Ltd> "The" Firm') }));
    const r = row(rows, "Company Name");
    expect(r.text).toBe('Smith & Sons <Ltd> "The" Firm');
    expect(r.html).toBe("Smith &amp; Sons &lt;Ltd&gt; &quot;The&quot; Firm");
  });

  it("escapes a URL's characters inside the link", () => {
    const rows = keyFactsRows(ABOUT_V1, withFields(data, { website_url: field('https://legiit.com/?a=1&b="2"') }));
    const r = row(rows, "Website");
    expect(r.html).toBe('<a href="https://legiit.com/?a=1&amp;b=&quot;2&quot;">legiit.com</a>');
  });

  it("never links an address that is not http(s)", () => {
    const rows = keyFactsRows(ABOUT_V1, withFields(data, { website_url: field("javascript:alert(1)") }));
    const r = row(rows, "Website");
    // the value shows as escaped text, never as a link
    expect(r.html).not.toContain("<a ");
    expect(r.html).not.toContain("href");
    expect(r.html).toBe(r.text);
    const social = keyFactsRows(
      ABOUT_V1,
      withFields(data, {
        social_profiles: field([{ platform: "facebook", url: "javascript:alert(1)", owner: "business" }]),
      }),
    );
    expect(row(social, "Social").html).toBe("Facebook");
  });

  it("drops a repeated profile address within a group", () => {
    const rows = keyFactsRows(
      ABOUT_V1,
      withFields(data, {
        social_profiles: field([
          { platform: "x", url: "https://x.com/legiitcom", owner: "business" },
          { platform: "twitter", url: "https://www.x.com/legiitcom/", owner: "" },
          { platform: "x", url: "https://x.com/LegiitCom?utm_source=site", owner: "Legiit" },
        ]),
      }),
    );
    expect(row(rows, "Social").text).toBe("X");
  });
});

describe("keyFactsRows with other shapes", () => {
  it("puts a person's credentials between the name and the title", () => {
    const rows = keyFactsRows(ABOUT_V1, loadFixture("darcy-bailey"));
    expect(row(rows, "Founder").text).toBe("Darcy Bailey, MSW, RSW, RCC, DipAT, Founder, Owner, and Clinical Director");
  });

  it("writes opening hours as days and times", () => {
    const spec: TemplateSpec = { ...ABOUT_V1, keyFactsRows: [{ label: "Hours", from: ["hours"] }] };
    const rows = keyFactsRows(spec, loadFixture("darcy-bailey"));
    expect(row(rows, "Hours").text).toBe(
      "Monday to Thursday 9 AM to 8 PM; Friday 9 AM to 7 PM; Saturday 9 AM to 5 PM; Sunday 11 AM to 5 PM",
    );
  });

  it("writes awards with the issuer and the year", () => {
    const spec: TemplateSpec = { ...ABOUT_V1, keyFactsRows: [{ label: "Awards", from: ["awards"] }] };
    const rows = keyFactsRows(spec, loadFixture("darcy-bailey"));
    expect(row(rows, "Awards").text.startsWith("Canadian Choice Award Winner, Mental Health Services, Langley (2024); ")).toBe(
      true,
    );
    expect(row(rows, "Awards").text).toContain("Best in Langley, Langley Advance Times (2025)");
  });

  it("renders an email as a mailto link", () => {
    const spec: TemplateSpec = { ...ABOUT_V1, keyFactsRows: [{ label: "Email", from: ["email"] }] };
    const rows = keyFactsRows(spec, loadFixture("darcy-bailey"));
    expect(row(rows, "Email").html).toBe('<a href="mailto:info@darcybaileycounselling.com">info@darcybaileycounselling.com</a>');
    expect(row(rows, "Email").text).toBe("info@darcybaileycounselling.com");
  });

  it("ignores a row that names no known field", () => {
    const spec: TemplateSpec = { ...ABOUT_V1, keyFactsRows: [{ label: "Nothing", from: ["no_such_field"] }] };
    expect(keyFactsRows(spec, loadFixture("legiit"))).toEqual([]);
  });
});

describe("value helpers", () => {
  const data = loadFixture("legiit");

  it("fieldValue is null for missing and empty fields and the value otherwise", () => {
    expect(fieldValue(data, "legal_name")).toBeNull();
    expect(fieldValue(data, "no_such_field")).toBeNull();
    expect(fieldValue(withFields(data, { category: field("  ") }), "category")).toBeNull();
    expect(fieldValue(withFields(data, { category: field("x", "missing") }), "category")).toBeNull();
    expect(fieldValue(data, "company_name")).toBe("Legiit");
  });

  it("fieldText and fieldList read by shape", () => {
    expect(fieldText(data, "company_name")).toBe("Legiit");
    expect(fieldText(data, "founders")).toBe("");
    expect(fieldList(data, "company_name")).toEqual([]);
    expect(fieldList(data, "competitors").map((i) => i.name)).toEqual([
      "Fiverr",
      "Upwork",
      "Traditional marketing and SEO agencies on retainer",
    ]);
  });

  it("cleanItems trims values and drops empty keys and items", () => {
    expect(cleanItems([{ name: "  A  B ", url: "" }, { name: "", url: "   " }, { name: "C" }])).toEqual([
      { name: "A B" },
      { name: "C" },
    ]);
  });

  it("formatDate spells out ISO dates and leaves other text alone", () => {
    expect(formatDate("2018-02-07")).toBe("February 7, 2018");
    expect(formatDate("2018-02")).toBe("February 2018");
    expect(formatDate("2018")).toBe("2018");
    expect(formatDate("February 7, 2018")).toBe("February 7, 2018");
    expect(formatDate("2018-13-01")).toBe("2018-13-01");
  });

  it("socialLabel names the platform, or the host for a website", () => {
    expect(socialLabel("youtube", "https://www.youtube.com/@LegiitOfficial")).toBe("YouTube");
    expect(socialLabel("linkedin", "https://www.linkedin.com/in/x")).toBe("LinkedIn");
    expect(socialLabel("", "https://x.com/legiitcom")).toBe("X");
    expect(socialLabel("twitter", "https://twitter.com/legiitcom")).toBe("X");
    expect(socialLabel("website", "https://chrismwalker.io")).toBe("chrismwalker.io");
    expect(socialLabel("", "https://chrismwalker.io/success-stories")).toBe("chrismwalker.io/success-stories");
    expect(socialLabel("mastodon", "https://mastodon.social/@x")).toBe("Mastodon");
  });

  it("isBusinessOwner reads an empty owner, 'business', or the company's name as the business", () => {
    expect(isBusinessOwner(undefined, "Legiit")).toBe(true);
    expect(isBusinessOwner("business", "Legiit")).toBe(true);
    expect(isBusinessOwner("The business", "Legiit")).toBe(true);
    expect(isBusinessOwner("legiit", "Legiit")).toBe(true);
    expect(isBusinessOwner("Chris M. Walker", "Legiit")).toBe(false);
    expect(isBusinessOwner("Chris M. Walker", "")).toBe(false);
  });

  it("awardLabel adds the issuer only when the name does not already say it", () => {
    expect(awardLabel({ name: "Canadian Choice Award Winner", issuer: "Canadian Choice Awards", year: "2025" })).toBe(
      "Canadian Choice Award Winner (2025)",
    );
    expect(awardLabel({ name: "Best in Langley", issuer: "Langley Advance Times", year: "2025" })).toBe(
      "Best in Langley, Langley Advance Times (2025)",
    );
    expect(awardLabel({ name: "Top Rated 2024", year: "2024" })).toBe("Top Rated 2024");
    expect(awardLabel({ issuer: "Nobody" })).toBe("");
  });
});
