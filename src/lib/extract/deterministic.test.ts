import { describe, expect, it } from "vitest";
import type { Json, JsonLdBlock, PageImage, PageLinks } from "@/lib/db/types";
import type { Finding } from "@/lib/facts/types";
import {
  findingsFromImages,
  findingsFromJsonLd,
  findingsFromLinks,
  findingsFromMeta,
  nameFromFileName,
} from "./deterministic";

const url = "https://darcybaileycounselling.com/about-us/";

const addressNode = {
  "@type": "PostalAddress",
  streetAddress: "#315, 20385 64 Avenue",
  addressLocality: "Langley",
  addressRegion: "BC",
  postalCode: "V2Y 1N5",
  addressCountry: "CA",
};

const org: Json = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["MedicalBusiness", "LocalBusiness"],
      "@id": "https://darcybaileycounselling.com/#organization",
      name: "Darcy Bailey & Associates Counselling",
      legalName: "Darcy Bailey & Associates Counselling Inc.",
      alternateName: ["Darcy Bailey Counselling", "Darcy Bailey and Associates"],
      url: "https://darcybaileycounselling.com/",
      logo: "https://darcybaileycounselling.com/wp-content/uploads/2026/10/DBA_LOGO-NEW-e1793212060559.png",
      telephone: "+1-604-533-9163",
      email: "info@darcybaileycounselling.com",
      address: addressNode,
      geo: { "@type": "GeoCoordinates", latitude: 49.119401, longitude: -122.6578649 },
      hasMap: "https://maps.app.goo.gl/9XSJ3jDrWSiEznJY9",
      areaServed: [{ "@type": "City", name: "Langley" }, { "@type": "City", name: "Surrey" }, "British Columbia"],
      openingHoursSpecification: [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday"],
          opens: "09:00",
          closes: "20:00",
        },
        { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Sunday", opens: "11:00", closes: "17:00" },
      ],
      priceRange: "$170 to $195 per 50-minute session",
      knowsLanguage: ["en", "es"],
      founder: {
        "@type": "Person",
        name: "Darcy Bailey",
        honorificSuffix: "MSW, RSW, RCC, DipAT",
        jobTitle: "Founder, Owner, and Clinical Director",
        url: "https://darcybaileycounselling.com/darcy-bailey/",
        sameAs: ["https://www.linkedin.com/in/darcybailey/", "https://www.youtube.com/@darcybailey"],
      },
      employee: [
        {
          "@type": "Person",
          name: "Nancy Orlikow",
          jobTitle: "Senior Therapist, Registered Clinical Counsellor",
          honorificSuffix: "MA, RCC, BCATR",
          url: "https://darcybaileycounselling.com/nancy-orlikow/",
        },
      ],
      numberOfEmployees: { "@type": "QuantitativeValue", value: 18 },
      award: ["Canadian Choice Award Winner, Mental Health Services, Langley (2024)", "Canadian Choice Award Winner (2025)"],
      memberOf: { "@type": "Organization", name: "BC Association of Clinical Counsellors" },
      sameAs: ["https://www.facebook.com/darcybaileycounselling", "https://www.instagram.com/dbailey_associatescounselling/"],
    },
    {
      "@type": ["AboutPage", "FAQPage"],
      "@id": "https://darcybaileycounselling.com/about-us/#webpage",
      url: "https://darcybaileycounselling.com/about-us/",
      about: { "@id": "https://darcybaileycounselling.com/#organization" },
      mainEntity: [
        {
          "@type": "Question",
          name: "Do I need a referral?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "<p>No. You can book directly by phone, through the contact form, or online.</p>",
          },
        },
      ],
    },
  ],
};

const blocks: JsonLdBlock[] = [
  { data: org, raw: JSON.stringify(org), types: ["MedicalBusiness", "LocalBusiness", "AboutPage", "FAQPage"] },
  { data: null, raw: "{ broken", error: "Unexpected token", types: [] },
];

const byField = (findings: Finding[], id: string) => findings.filter((f) => f.fieldId === id);
const values = (findings: Finding[], id: string) => byField(findings, id).map((f) => f.value);

describe("findingsFromJsonLd", () => {
  const findings = findingsFromJsonLd(blocks, url);

  it("maps the organization scalars with the raw value as the quote", () => {
    expect(byField(findings, "company_name")).toEqual([
      {
        fieldId: "company_name",
        value: "Darcy Bailey & Associates Counselling",
        quote: "Darcy Bailey & Associates Counselling",
        url,
        source: "jsonld",
        confidence: 0.9,
      },
    ]);
    expect(values(findings, "legal_name")).toEqual(["Darcy Bailey & Associates Counselling Inc."]);
    expect(values(findings, "phone")).toEqual(["+1-604-533-9163"]);
    expect(values(findings, "email")).toEqual(["info@darcybaileycounselling.com"]);
    expect(values(findings, "website_url")).toEqual(["https://darcybaileycounselling.com/"]);
    expect(values(findings, "logo_url")).toEqual([
      "https://darcybaileycounselling.com/wp-content/uploads/2026/10/DBA_LOGO-NEW-e1793212060559.png",
    ]);
    expect(values(findings, "geo")).toEqual(["49.119401, -122.6578649"]);
    expect(values(findings, "map_url")).toEqual(["https://maps.app.goo.gl/9XSJ3jDrWSiEznJY9"]);
    expect(values(findings, "price_range")).toEqual(["$170 to $195 per 50-minute session"]);
    expect(values(findings, "team_size")).toEqual(["18"]);
  });

  it("maps the address with the node JSON as the quote", () => {
    const [hq] = byField(findings, "headquarters");
    expect(hq.value).toEqual({
      streetAddress: "#315, 20385 64 Avenue",
      addressLocality: "Langley",
      addressRegion: "BC",
      postalCode: "V2Y 1N5",
      addressCountry: "CA",
      text: "#315, 20385 64 Avenue, Langley, BC, V2Y 1N5, CA",
    });
    expect(hq.quote).toBe(JSON.stringify(addressNode));
  });

  it("maps list fields: alternate names, social profiles, awards, areas, hours, languages, memberships", () => {
    expect(values(findings, "alternate_names")).toEqual([
      [{ name: "Darcy Bailey Counselling" }],
      [{ name: "Darcy Bailey and Associates" }],
    ]);
    // The organization's sameAs is the business's; the founder's Person sameAs is hers.
    expect(byField(findings, "social_profiles").map((f) => [f.value, f.quote])).toEqual([
      [
        [{ platform: "facebook", url: "https://www.facebook.com/darcybaileycounselling", owner: "business" }],
        "https://www.facebook.com/darcybaileycounselling",
      ],
      [
        [{ platform: "instagram", url: "https://www.instagram.com/dbailey_associatescounselling/", owner: "business" }],
        "https://www.instagram.com/dbailey_associatescounselling/",
      ],
      [
        [{ platform: "linkedin", url: "https://www.linkedin.com/in/darcybailey/", owner: "Darcy Bailey" }],
        "https://www.linkedin.com/in/darcybailey/",
      ],
      [
        [{ platform: "youtube", url: "https://www.youtube.com/@darcybailey", owner: "Darcy Bailey" }],
        "https://www.youtube.com/@darcybailey",
      ],
    ]);
    expect(byField(findings, "social_profiles").every((f) => !f.derived)).toBe(true);
    expect(values(findings, "awards")).toEqual([
      [{ name: "Canadian Choice Award Winner, Mental Health Services, Langley (2024)" }],
      [{ name: "Canadian Choice Award Winner (2025)" }],
    ]);
    expect(values(findings, "area_served")).toEqual([[{ name: "Langley" }], [{ name: "Surrey" }], [{ name: "British Columbia" }]]);
    expect(values(findings, "hours")).toEqual([
      [{ days: "Monday to Thursday", opens: "9:00 AM", closes: "8:00 PM" }],
      [{ days: "Sunday", opens: "11:00 AM", closes: "5:00 PM" }],
    ]);
    expect(values(findings, "languages")).toEqual([[{ name: "English" }], [{ name: "Spanish" }]]);
    expect(values(findings, "memberships")).toEqual([[{ name: "BC Association of Clinical Counsellors" }]]);
  });

  it("maps founders with social keys by host, and employees as team members", () => {
    expect(values(findings, "founders")).toEqual([
      [
        {
          name: "Darcy Bailey",
          title: "Founder, Owner, and Clinical Director",
          credentials: "MSW, RSW, RCC, DipAT",
          url: "https://darcybaileycounselling.com/darcy-bailey/",
          linkedin: "https://www.linkedin.com/in/darcybailey/",
          youtube: "https://www.youtube.com/@darcybailey",
        },
      ],
    ]);
    expect(values(findings, "team_members")).toEqual([
      [
        {
          name: "Nancy Orlikow",
          role: "Senior Therapist, Registered Clinical Counsellor",
          credentials: "MA, RCC, BCATR",
          url: "https://darcybaileycounselling.com/nancy-orlikow/",
        },
      ],
    ]);
  });

  it("maps FAQPage questions from the @graph and strips HTML from answers", () => {
    expect(values(findings, "existing_faqs")).toEqual([
      [
        {
          question: "Do I need a referral?",
          answer: "No. You can book directly by phone, through the contact form, or online.",
          url,
        },
      ],
    ]);
  });

  it("does not treat a memberOf organization as the business", () => {
    expect(byField(findings, "company_name")).toHaveLength(1);
  });
});

describe("findingsFromLinks", () => {
  const links: PageLinks = {
    tel: ["tel:+16045339163"],
    mailto: ["mailto:info@darcybaileycounselling.com?subject=Hello"],
    social: [
      { platform: "facebook", url: "https://www.facebook.com/darcybaileycounselling" },
      { platform: "facebook", url: "https://www.facebook.com/sharer/sharer.php?u=https://darcybaileycounselling.com/" },
      { platform: "twitter", url: "https://twitter.com/darcybailey" },
    ],
    maps: ["https://maps.app.goo.gl/9XSJ3jDrWSiEznJY9"],
  };
  const findings = findingsFromLinks(links, url);

  it("maps tel and mailto links with the href as the quote", () => {
    expect(byField(findings, "phone")).toEqual([
      { fieldId: "phone", value: "+16045339163", quote: "tel:+16045339163", url, source: "link", confidence: 0.8 },
    ]);
    expect(byField(findings, "email")[0]).toMatchObject({
      value: "info@darcybaileycounselling.com",
      quote: "mailto:info@darcybaileycounselling.com?subject=Hello",
    });
  });

  it("maps profile links with no owner, marked derived, skips share links, and reads twitter as x", () => {
    expect(values(findings, "social_profiles")).toEqual([
      [{ platform: "facebook", url: "https://www.facebook.com/darcybaileycounselling", owner: "" }],
      [{ platform: "x", url: "https://twitter.com/darcybailey", owner: "" }],
    ]);
    for (const f of byField(findings, "social_profiles")) {
      expect(f).toMatchObject({ derived: true, note: "linked from /about-us; confirm whose profile this is" });
    }
    expect(values(findings, "map_url")).toEqual(["https://maps.app.goo.gl/9XSJ3jDrWSiEznJY9"]);
  });

  it("does not hand a founder's or a guest author's linked profile to the business", () => {
    const post = "https://legiit.com/blog/guest-post/";
    const [guest] = findingsFromLinks({ social: [{ platform: "linkedin", url: "https://www.linkedin.com/in/guest-writer/" }] }, post);
    expect(guest.value).toEqual([{ platform: "linkedin", url: "https://www.linkedin.com/in/guest-writer/", owner: "" }]);
    expect(guest.note).toBe("linked from /blog/guest-post; confirm whose profile this is");
    const [home] = findingsFromLinks({ social: [{ platform: "youtube", url: "https://www.youtube.com/@ChrisMWalker" }] }, "https://legiit.com/");
    expect(home.note).toBe("linked from the home page; confirm whose profile this is");
  });
});

describe("findingsFromJsonLd business type", () => {
  const block = (data: Json): JsonLdBlock => ({ data, raw: JSON.stringify(data), types: [] });
  const typeOf = (data: Json) => byField(findingsFromJsonLd([block(data)], url), "business_type");

  it("takes a specific type from the site's own organization block, with the raw type as the quote", () => {
    expect(typeOf({ "@context": "https://schema.org", "@type": "RoofingContractor", name: "Acme Roofing" })).toEqual([
      { fieldId: "business_type", value: "RoofingContractor", quote: "RoofingContractor", url, source: "jsonld", confidence: 0.9 },
    ]);
    const both = typeOf({ "@context": "https://schema.org", "@type": ["LocalBusiness", "Dentist"], name: "Bright Smiles" });
    expect(both.map((f) => f.value)).toEqual(["LocalBusiness"]);
    expect(both[0].quote).toBe(JSON.stringify(["LocalBusiness", "Dentist"]));
  });

  it("leaves the generic types, other organizations, and people alone", () => {
    expect(typeOf({ "@context": "https://schema.org", "@type": "Organization", name: "Acme Roofing" })).toEqual([]);
    expect(typeOf({ "@context": "https://schema.org", "@type": "Corporation", name: "Acme Roofing" })).toEqual([]);
    expect(
      typeOf({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Acme Roofing",
        memberOf: { "@type": "ProfessionalService", name: "The Roofers Guild" },
      }),
    ).toEqual([]);
    expect(typeOf({ "@context": "https://schema.org", "@type": "Person", name: "Maria Lopez" })).toEqual([]);
  });
});

describe("findingsFromJsonLd person profiles", () => {
  it("gives a Person node's sameAs that person's name as owner, wherever the node sits", () => {
    const article: Json = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "How to hire a freelancer",
      author: { "@type": "Person", name: "Guest Writer", sameAs: ["https://www.linkedin.com/in/guest-writer/"] },
    };
    const profile: Json = {
      "@context": "https://schema.org",
      "@type": "Person",
      givenName: "Chris",
      familyName: "Walker",
      sameAs: "https://www.youtube.com/@ChrisMWalker",
    };
    const findings = findingsFromJsonLd(
      [
        { data: article, raw: JSON.stringify(article), types: ["BlogPosting"] },
        { data: profile, raw: JSON.stringify(profile), types: ["Person"] },
      ],
      "https://legiit.com/blog/how-to-hire/",
    );
    expect(values(findings, "social_profiles")).toEqual([
      [{ platform: "linkedin", url: "https://www.linkedin.com/in/guest-writer/", owner: "Guest Writer" }],
      [{ platform: "youtube", url: "https://www.youtube.com/@ChrisMWalker", owner: "Chris Walker" }],
    ]);
    expect(byField(findings, "company_name")).toEqual([]);
  });
});

describe("findingsFromImages", () => {
  const images: PageImage[] = [
    { src: "/wp-content/uploads/2026/10/DBA_LOGO-NEW.png", alt: "Darcy Bailey & Associates Counselling", kind: "logo", reason: "class" },
    { src: "https://darcybaileycounselling.com/wp-content/uploads/canadian-choice-2024.png", alt: "", kind: "award", reason: "file name" },
    { src: "https://darcybaileycounselling.com/wp-content/uploads/badge2.png", alt: "Three Best Rated Marriage Counselling Langley 2024", kind: "award", reason: "alt" },
    { src: "https://darcybaileycounselling.com/other-logo.png", alt: "", kind: "logo", reason: "file name" },
  ];
  const findings = findingsFromImages(images, url);

  it("takes the first logo, resolved against the page", () => {
    expect(byField(findings, "logo_url")).toEqual([
      {
        fieldId: "logo_url",
        value: "https://darcybaileycounselling.com/wp-content/uploads/2026/10/DBA_LOGO-NEW.png",
        quote: "https://darcybaileycounselling.com/wp-content/uploads/2026/10/DBA_LOGO-NEW.png",
        url,
        source: "image",
        confidence: 0.6,
      },
    ]);
  });

  it("derives award names from the file name or the alt text and marks them derived", () => {
    const awards = byField(findings, "awards");
    expect(awards).toHaveLength(2);
    expect(awards[0]).toMatchObject({
      value: [{ name: "Canadian Choice 2024", year: "2024" }],
      quote: "https://darcybaileycounselling.com/wp-content/uploads/canadian-choice-2024.png",
      confidence: 0.4,
      derived: true,
      note: "from image file name; confirm the award and year",
    });
    expect(awards[1]).toMatchObject({
      value: [{ name: "Three Best Rated Marriage Counselling Langley 2024", year: "2024" }],
      derived: true,
    });
  });

  it("turns file names into readable names", () => {
    expect(nameFromFileName("https://x.com/img/langley_advance_times-best-of-2025-300x200.png")).toBe(
      "Langley Advance Times Best Of 2025",
    );
  });
});

describe("findingsFromMeta", () => {
  it("uses the canonical as the website URL on the home page only", () => {
    const home = findingsFromMeta({ canonical: "https://darcybaileycounselling.com/", title: "Home" }, "https://darcybaileycounselling.com/?ref=x", true);
    expect(home).toEqual([
      {
        fieldId: "website_url",
        value: "https://darcybaileycounselling.com/",
        quote: "https://darcybaileycounselling.com/",
        url: "https://darcybaileycounselling.com/?ref=x",
        source: "meta",
        confidence: 0.9,
      },
    ]);
    expect(findingsFromMeta({ canonical: "https://darcybaileycounselling.com/about-us/" }, url, false)).toEqual([]);
  });

  it("falls back to the crawled origin, marked derived, when the home page has no canonical", () => {
    const [f] = findingsFromMeta({}, "https://darcybaileycounselling.com/index.php", true);
    expect(f).toMatchObject({ fieldId: "website_url", value: "https://darcybaileycounselling.com/", derived: true });
  });
});
