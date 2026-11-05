import { describe, expect, it } from "vitest";
import {
  clockReadings,
  clockTimesIn,
  datesIn,
  dayKey,
  daysNamed,
  givenNamesCompatible,
  levenshtein,
  normalizeDate,
  normalizeForCompare,
  normalizeItemKey,
  normalizePhone,
  normalizeUrl,
  personNameKey,
  platformFromUrl,
  samePerson,
  timeKey,
} from "./normalize";

describe("datesIn", () => {
  it("reads named months with their days, ISO dates, and both readings of a numeric date", () => {
    expect(datesIn("It launched on February 7, 2018")).toEqual([{ month: 2, day: 7 }]);
    expect(datesIn("On the 18th of May, 2016 he resigned")).toEqual([{ month: 5, day: 18 }]);
    expect(datesIn("Open since Feb. 2018")).toEqual([{ month: 2, day: null }]);
    expect(datesIn("2018-02-07")).toEqual([{ month: 2, day: 7 }]);
    expect(datesIn("03/07/2018")).toEqual([
      { month: 3, day: 7 },
      { month: 7, day: 3 },
    ]);
    expect(datesIn("13/07/2018")).toEqual([{ month: 7, day: 13 }]);
  });

  it("finds no month in a bare year, a season, or a month word with no number next to it", () => {
    expect(datesIn("since 2018")).toEqual([]);
    expect(datesIn("in the spring of 2018")).toEqual([]);
    expect(datesIn("you may book online")).toEqual([]);
    expect(datesIn("Call 604-533-9163")).toEqual([]);
  });
});

describe("daysNamed and dayKey", () => {
  it("expands runs and groups of days the way pages write them", () => {
    const set = (s: string) => [...daysNamed(s)].sort();
    expect(set("Mon - Thu: 9am - 8pm")).toEqual([0, 1, 2, 3]);
    expect(set("Monday to Thursday")).toEqual([0, 1, 2, 3]);
    expect(set("Mon-Fri 09:00-17:00")).toEqual([0, 1, 2, 3, 4]);
    expect(set("Monday through Friday")).toEqual([0, 1, 2, 3, 4]);
    expect(set("Weekdays 8am to 5pm")).toEqual([0, 1, 2, 3, 4]);
    expect(set("Tues, Thurs & Sat")).toEqual([1, 3, 5]);
    expect(set("Weekends")).toEqual([5, 6]);
    expect(set("Open daily")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(set("Fri - Mon")).toEqual([0, 4, 5, 6]);
    expect(set("Public holidays")).toEqual([]);
    // Words that only start like a day are not days.
    expect(set("monthly, satisfaction, sundry")).toEqual([]);
  });

  it("gives one key to one set of days however it is written", () => {
    expect(dayKey("Mon - Thu")).toBe(dayKey("Monday to Thursday"));
    expect(dayKey("Weekdays")).toBe(dayKey("Monday to Friday"));
    expect(dayKey("Monday")).not.toBe(dayKey("Monday to Thursday"));
    expect(dayKey("Monday to Thursday (admin office)")).not.toBe(dayKey("Monday to Thursday"));
    expect(dayKey("Public holidays")).toBe("");
  });
});

describe("clock times", () => {
  it("reads a time value in minutes, with both readings when it has no am or pm", () => {
    expect(clockReadings("5:00 PM")).toEqual([1020]);
    expect(clockReadings("5 pm")).toEqual([1020]);
    expect(clockReadings("17:00")).toEqual([1020]);
    expect(clockReadings("9:00 a.m.")).toEqual([540]);
    expect(clockReadings("12 PM")).toEqual([720]);
    expect(clockReadings("12 AM")).toEqual([0]);
    expect(clockReadings("noon")).toEqual([720]);
    expect(clockReadings("9")).toEqual([540, 1260]);
    expect(clockReadings("Closed")).toBeNull();
    expect(clockReadings("13 PM")).toBeNull();
  });

  it("reads the times a text states, not prices, counts, or street numbers", () => {
    expect([...clockTimesIn("Mon - Thu: 9am - 8pm")].sort((a, b) => a - b)).toEqual([540, 1200]);
    expect([...clockTimesIn("Mon-Fri 09:00-17:00")].sort((a, b) => a - b)).toEqual([540, 1020, 1260]);
    expect([...clockTimesIn("Weekdays 9-5pm")].sort((a, b) => a - b)).toEqual([540, 1020, 1260]);
    expect([...clockTimesIn("Mon-Fri 9.30am - 5.30pm")].sort((a, b) => a - b)).toEqual([570, 1050]);
    expect(clockReadings("5.30 pm")).toEqual([1050]);
    expect([...clockTimesIn("Fees are $170 at #315, 20385 64 Avenue")]).toEqual([]);
  });

  it("gives one key to one time however it is written", () => {
    expect(timeKey("9 AM")).toBe(timeKey("9:00 AM"));
    expect(timeKey("09:00")).toBe(timeKey("9am"));
    expect(timeKey("17:00")).toBe(timeKey("5:00 PM"));
    expect(timeKey("5 PM")).not.toBe(timeKey("5 AM"));
    // A bare hour could be either half of the day, so it has no time key.
    expect(timeKey("9")).toBe("");
  });
});

describe("givenNamesCompatible", () => {
  it("accepts the same given name, an initial, or a short form, and nothing else", () => {
    expect(givenNamesCompatible("jim", "jim")).toBe(true);
    expect(givenNamesCompatible("j", "jim")).toBe(true);
    expect(givenNamesCompatible("pal", "palvinder")).toBe(true);
    expect(givenNamesCompatible("mark", "mary")).toBe(false);
    expect(givenNamesCompatible("djordje", "marija")).toBe(false);
    expect(givenNamesCompatible("", "jim")).toBe(false);
  });
});

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

  it("allows a typo in one name token, never a different short name", () => {
    expect(samePerson("Mark Bailey", "Mary Bailey")).toBe(false);
    expect(samePerson("Ann Lee", "Amy Lee")).toBe(false);
    expect(samePerson("Jon Smith", "Joe Smith")).toBe(false);
    expect(samePerson("Dan Brown", "Dana Brown")).toBe(false);
    expect(samePerson("Chris Walker", "Chris Walter")).toBe(false);
    expect(samePerson("Christina Walker", "Christine Walker")).toBe(false);
    // Swapped neighbours, a doubled letter, or one edit in a long surname are typos.
    expect(samePerson("Trish Rapske", "Trish Rapkse")).toBe(true);
    expect(samePerson("Michelle Phillips", "Michelle Philips")).toBe(true);
    expect(samePerson("Rhonda MacWilliams", "Rhonda McWilliams")).toBe(true);
    expect(samePerson("Swetha Ranasuirya", "Swetha Ranasurya")).toBe(true);
    // Two tokens off is two people.
    expect(samePerson("Swteha Ranasuirya", "Swetha Ranasuriya")).toBe(false);
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
