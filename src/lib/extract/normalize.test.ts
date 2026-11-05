import { describe, expect, it } from "vitest";
import {
  levenshtein,
  normalizeDate,
  normalizeForCompare,
  normalizeItemKey,
  normalizePhone,
  normalizeUrl,
  personNameKey,
  platformFromUrl,
  samePerson,
} from "./normalize";

describe("normalizePhone", () => {
  it("keeps digits only and drops the leading 1 of an 11-digit North American number", () => {
    expect(normalizePhone("+1 (604) 533-9163")).toBe("6045339163");
    expect(normalizePhone("604.533.9163")).toBe("6045339163");
    expect(normalizePhone("tel:+16045339163")).toBe("6045339163");
    expect(normalizePhone("+44 20 7946 0958")).toBe("442079460958");
    expect(normalizePhone("604-533-9163 ext. 2")).toBe("6045339163");
  });
});

describe("normalizeUrl", () => {
  it("strips protocol, www, trailing slash, hash, and utm params", () => {
    expect(normalizeUrl("https://www.youtube.com/@ChrisMWalker/")).toBe("youtube.com/@chrismwalker");
    expect(normalizeUrl("http://legiit.com/?utm_source=x&utm_medium=y")).toBe("legiit.com");
    expect(normalizeUrl("legiit.com/about#team")).toBe("legiit.com/about");
    expect(normalizeUrl("https://x.com/legiitcom?ref=site&fbclid=1")).toBe("x.com/legiitcom?ref=site");
  });
});

describe("normalizeDate", () => {
  it("returns the year when there is one, otherwise the text", () => {
    expect(normalizeDate("February 7, 2018")).toBe("2018");
    expect(normalizeDate("2018-02-07")).toBe("2018");
    expect(normalizeDate("17+ years")).toBe("17+ years");
    expect(normalizeDate("17+ years")).not.toBe(normalizeDate("19+ years"));
  });
});

describe("normalizeForCompare", () => {
  it("picks the rule by field type", () => {
    expect(normalizeForCompare("email", " Info@DarcyBaileyCounselling.com ")).toBe("info@darcybaileycounselling.com");
    expect(normalizeForCompare("text", "\u201CLegiit.\u201D")).toBe("legiit");
    expect(normalizeForCompare("text", "Darcy Bailey & Associates")).toBe("darcy bailey and associates");
    expect(normalizeForCompare("number", "25,000+")).toBe("25000");
    expect(normalizeForCompare("url", "https://legiit.com/")).toBe(normalizeForCompare("url", "legiit.com"));
    expect(normalizeForCompare("text", null)).toBe("");
  });

  it("compares addresses by their parts with region codes, ignoring the country", () => {
    const a = normalizeForCompare("address", {
      streetAddress: "#315, 20385 64 Avenue",
      addressLocality: "Langley",
      addressRegion: "British Columbia",
      postalCode: "V2Y 1N5",
      addressCountry: "Canada",
    });
    const b = normalizeForCompare("address", {
      streetAddress: "315 - 20385 64 Ave",
      addressLocality: "Langley",
      addressRegion: "BC",
      postalCode: "v2y1n5",
      addressCountry: "CA",
      text: "315 - 20385 64 Ave, Langley, BC v2y1n5",
    });
    expect(a).toBe("315 20385 64 ave langley bc v2y1n5");
    expect(b).toBe(a);
    expect(normalizeForCompare("address", { text: "Fully remote, registered in Myrtle Beach, SC" })).toBe(
      "fully remote registered in myrtle beach sc",
    );
  });
});

describe("normalizeItemKey and personNameKey", () => {
  it("normalizes item keys like text", () => {
    expect(normalizeItemKey("  Couples Counselling. ")).toBe("couples counselling");
    expect(normalizeItemKey(undefined)).toBe("");
  });

  it("strips honorifics, credentials, and initial periods from names", () => {
    expect(personNameKey("Dr. Darcy Bailey, MSW, RSW, RCC")).toBe("darcy bailey");
    expect(personNameKey("Chris M. Walker")).toBe("chris m walker");
    expect(personNameKey("  Pal (Palvinder)  Manhas ")).toBe("pal manhas");
  });
});

describe("levenshtein", () => {
  it("counts edits", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
    expect(levenshtein("Ranasuirya", "Ranasuriya")).toBe(2);
  });
});

describe("samePerson", () => {
  it("matches small spelling differences and dropped middle initials, not different people", () => {
    expect(samePerson("Swetha Ranasuirya", "Swetha Ranasuriya")).toBe(true);
    expect(samePerson("Chris M. Walker", "Chris Walker")).toBe(true);
    expect(samePerson("Chris Michael Walker", "Chris Walker")).toBe(true);
    expect(samePerson("Dr. Darcy Bailey, MSW", "Darcy Bailey")).toBe(true);
    expect(samePerson("Pal Manhas", "Palvinder Manhas-Bains")).toBe(false);
    expect(samePerson("Jim", "Jim Sabellico")).toBe(false);
    expect(samePerson("Marija Jovanovic", "Djordje Jovanovic")).toBe(false);
    expect(samePerson("", "Jim Sabellico")).toBe(false);
  });
});

describe("platformFromUrl", () => {
  it("names the platform from the host", () => {
    expect(platformFromUrl("https://www.youtube.com/@LegiitOfficial")).toBe("youtube");
    expect(platformFromUrl("https://twitter.com/legiitcom")).toBe("x");
    expect(platformFromUrl("https://x.com/legiitcom")).toBe("x");
    expect(platformFromUrl("https://www.linkedin.com/company/legiit")).toBe("linkedin");
    expect(platformFromUrl("https://www.instagram.com/cmwlegiit/")).toBe("instagram");
    expect(platformFromUrl("https://www.tiktok.com/@legiit")).toBe("tiktok");
    expect(platformFromUrl("https://www.threads.net/@legiit")).toBe("threads");
    expect(platformFromUrl("https://www.pinterest.ca/legiit/")).toBe("pinterest");
    expect(platformFromUrl("https://maps.app.goo.gl/9XSJ3jDrWSiEznJY9")).toBe("google");
    expect(platformFromUrl("https://www.google.com/maps/place/Darcy+Bailey")).toBe("google");
    expect(platformFromUrl("https://chrismwalker.io")).toBe("website");
    expect(platformFromUrl("chrismwalker.io/success-stories")).toBe("website");
    expect(platformFromUrl("mailto:help@legiit.com")).toBeNull();
    expect(platformFromUrl("not a url")).toBeNull();
    expect(platformFromUrl("")).toBeNull();
  });
});
