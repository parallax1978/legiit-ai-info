import { describe, expect, it } from "vitest";
import type { FactValue, Finding } from "@/lib/facts/types";
import { ABOUT_V1 } from "@/templates/about-v1";
import { applyUserEdit, mergeFindings, recomputeStats } from "./merge";

const HOME = "https://darcybaileycounselling.com/";
const CONTACT = "https://darcybaileycounselling.com/contact/";
const FEES = "https://darcybaileycounselling.com/fees/";
const FAQ = "https://darcybaileycounselling.com/faq/";
const ABOUT = "https://legiit.com/about";

function finding(fieldId: string, value: FactValue, quote: string, url: string, extra: Partial<Finding> = {}): Finding {
  return { fieldId, value, quote, url, source: "page", confidence: 0.9, ...extra };
}

describe("mergeFindings scalars", () => {
  it("marks a phone two pages agree on as found with both quotes", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("phone", "604-533-9163", "Call 604-533-9163", CONTACT),
      finding("phone", "+16045339163", "tel:+16045339163", HOME, { source: "link", confidence: 0.8 }),
    ]);
    const phone = data.fields.phone;
    expect(phone.status).toBe("found");
    expect(["604-533-9163", "+16045339163"]).toContain(phone.value);
    expect(phone.evidence).toEqual([
      { quote: "Call 604-533-9163", url: CONTACT, source: "page" },
      { quote: "tel:+16045339163", url: HOME, source: "link" },
    ]);
    expect(phone.candidates).toBeUndefined();
  });

  it("treats a full founding date and its year as one value, preferring the ISO date", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("founded_date", "2018", "Over one million orders since 2018", ABOUT),
      finding("founded_date", "2018-02-07", "2018-02-07", ABOUT, { source: "jsonld" }),
      finding("founded_date", "February 7, 2018", "Legiit launched on February 7, 2018.", ABOUT),
    ]);
    const founded = data.fields.founded_date;
    expect(founded.status).toBe("found");
    expect(founded.value).toBe("2018-02-07");
    expect(founded.evidence).toHaveLength(3);
  });

  it("turns disagreeing years-in-business claims into a conflict with ordered candidates", () => {
    const { data, stats } = mergeFindings(ABOUT_V1, [
      finding("years_in_business", "17+ years", "serving Langley for 17+ years", HOME),
      finding("years_in_business", "19+ years", "over 19+ years of experience", FAQ),
      finding("years_in_business", "19+ years", "19+ years in Langley", CONTACT),
    ]);
    const years = data.fields.years_in_business;
    expect(years.status).toBe("conflict");
    expect(years.candidates).toHaveLength(2);
    expect(years.candidates?.[0].value).toBe("19+ years");
    expect(years.candidates?.[0].evidence).toHaveLength(2);
    expect(years.candidates?.[1].value).toBe("17+ years");
    expect(years.value).toBe("19+ years");
    expect(years.evidence).toEqual(years.candidates?.[0].evidence);
    expect(stats.conflict).toBe(1);
    // founded_date is a separate field; a years claim never feeds it.
    expect(data.fields.founded_date.status).toBe("missing");
  });

  it("picks the address with the most parts when pages agree", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("headquarters", { text: "#315 - 20385 64 Avenue, Langley, BC V2Y 1N5", streetAddress: "#315 - 20385 64 Avenue", addressLocality: "Langley", addressRegion: "BC", postalCode: "V2Y 1N5" }, "#315 - 20385 64 Avenue, Langley, BC V2Y 1N5", CONTACT),
      finding(
        "headquarters",
        { streetAddress: "#315, 20385 64 Avenue", addressLocality: "Langley", addressRegion: "BC", postalCode: "V2Y 1N5", addressCountry: "CA", text: "#315, 20385 64 Avenue, Langley, BC, V2Y 1N5, CA" },
        '{"@type":"PostalAddress"}',
        HOME,
        { source: "jsonld" },
      ),
    ]);
    const hq = data.fields.headquarters;
    expect(hq.status).toBe("found");
    expect(hq.value).toMatchObject({ addressCountry: "CA" });
    expect(hq.evidence).toHaveLength(2);
  });
});

describe("mergeFindings lists", () => {
  it("merges pricing items with the same name and records a conflict on price", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("pricing", [{ name: "Couples counselling", price: "$195" }], "Couples sessions are $195", FEES),
      finding("pricing", [{ name: "Couples Counselling", price: "$185", notes: "per 50-minute session" }], "couples counselling at $185", FAQ),
      finding("pricing", [{ name: "Couples counselling", price: "$195" }], "$195 for couples", HOME),
    ]);
    const pricing = data.fields.pricing;
    expect(pricing.status).toBe("found");
    expect(pricing.value).toEqual([{ name: "Couples counselling", price: "$195", notes: "per 50-minute session" }]);
    expect(pricing.itemConflicts).toHaveLength(1);
    const conflict = pricing.itemConflicts?.[0];
    expect(conflict?.key).toBe("Couples counselling");
    expect(conflict?.on).toEqual(["price"]);
    expect(conflict?.candidates).toHaveLength(2);
    expect(conflict?.candidates[0].value).toEqual([{ name: "Couples counselling", price: "$195" }]);
    expect(conflict?.candidates[0].evidence).toHaveLength(2);
    expect(conflict?.candidates[1].value).toEqual([{ name: "Couples Counselling", price: "$185", notes: "per 50-minute session" }]);
    expect(pricing.evidence).toHaveLength(3);
  });

  it("merges a team member spelled two ways with the same url into one item with a name conflict", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding(
        "team_members",
        [{ name: "Swetha Ranasuirya", role: "Registered Clinical Counsellor", url: "https://darcybaileycounselling.com/swetha-ranasuriya/" }],
        "Swetha Ranasuirya, MA, DVATI, RCC, RCAT",
        "https://darcybaileycounselling.com/our-team/",
      ),
      finding(
        "team_members",
        [{ name: "Swetha Ranasuriya", role: "Registered Clinical Counsellor", credentials: "MA, DVATI, RCC, RCAT", url: "https://darcybaileycounselling.com/swetha-ranasuriya" }],
        "Swetha Ranasuriya",
        "https://darcybaileycounselling.com/swetha-ranasuriya/",
      ),
      finding("team_members", [{ name: "Nancy Orlikow", role: "Senior Therapist" }], "Nancy Orlikow", "https://darcybaileycounselling.com/our-team/"),
    ]);
    const team = data.fields.team_members;
    expect(team.value).toHaveLength(2);
    expect(team.value).toMatchObject([
      { name: "Swetha Ranasuirya", role: "Registered Clinical Counsellor", credentials: "MA, DVATI, RCC, RCAT" },
      { name: "Nancy Orlikow" },
    ]);
    expect(team.itemConflicts).toHaveLength(1);
    expect(team.itemConflicts?.[0]).toMatchObject({ key: "Swetha Ranasuirya", on: ["name"] });
    expect(team.itemConflicts?.[0].candidates.map((c) => c.value)).toEqual([
      [expect.objectContaining({ name: "Swetha Ranasuirya" })],
      [expect.objectContaining({ name: "Swetha Ranasuriya" })],
    ]);
  });

  it("joins a first name and a full name that share a profile url", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("founders", [{ name: "Jim", title: "Co-founder and CTO", url: "https://legiit.com/team/jim" }], '"name": "Jim"', ABOUT, { source: "jsonld" }),
      finding("founders", [{ name: "Jim Sabellico", title: "Co-founder and CTO", url: "https://legiit.com/team/jim/" }], "Jim Sabellico, Co-founder and CTO", ABOUT),
      finding("founders", [{ name: "Chris M. Walker", title: "Founder and CEO" }], "Chris M. Walker, Founder and CEO", ABOUT),
      finding("founders", [{ name: "Chris Walker", title: "Founder and CEO", linkedin: "https://www.linkedin.com/in/superstarseo/" }], "Chris Walker", HOME),
    ]);
    const founders = data.fields.founders;
    expect(founders.value).toHaveLength(2);
    expect(founders.value).toMatchObject([
      { name: "Jim", title: "Co-founder and CTO" },
      { name: "Chris M. Walker", title: "Founder and CEO", linkedin: "https://www.linkedin.com/in/superstarseo/" },
    ]);
    expect(founders.itemConflicts?.map((c) => [c.key, c.on])).toEqual([
      ["Jim", ["name"]],
      ["Chris M. Walker", ["name"]],
    ]);
  });

  it("dedupes social profiles on the URL with and without a trailing slash", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("social_profiles", [{ platform: "youtube", url: "https://www.youtube.com/@LegiitOfficial", owner: "business" }], "https://www.youtube.com/@LegiitOfficial", ABOUT, { source: "link" }),
      finding("social_profiles", [{ platform: "youtube", url: "https://www.youtube.com/@LegiitOfficial/", owner: "business" }], "https://www.youtube.com/@LegiitOfficial/", HOME, { source: "jsonld" }),
      finding("social_profiles", [{ platform: "x", url: "https://x.com/legiitcom", owner: "business" }], "https://x.com/legiitcom", HOME, { source: "link" }),
    ]);
    const social = data.fields.social_profiles;
    expect(social.value).toEqual([
      { platform: "youtube", url: "https://www.youtube.com/@LegiitOfficial", owner: "business" },
      { platform: "x", url: "https://x.com/legiitcom", owner: "business" },
    ]);
    expect(social.itemConflicts).toBeUndefined();
    expect(social.evidence).toHaveLength(3);
  });

  it("caps list evidence at 20 entries, keeping the earliest", () => {
    const findings = Array.from({ length: 25 }, (_, i) =>
      finding("competitors", [{ name: `Competitor ${i}` }], `quote ${i}`, `${HOME}page-${i}/`),
    );
    const { data } = mergeFindings(ABOUT_V1, findings);
    expect(data.fields.competitors.value).toHaveLength(25);
    expect(data.fields.competitors.evidence).toHaveLength(20);
    expect(data.fields.competitors.evidence[0].quote).toBe("quote 0");
  });

  it("marks a field derived only when every finding was derived", () => {
    const derivedOnly = mergeFindings(ABOUT_V1, [
      finding("awards", [{ name: "Canadian Choice 2024" }], "https://x.com/canadian-choice-2024.png", HOME, { source: "image", confidence: 0.4, derived: true, note: "from image file name; confirm the award and year" }),
    ]);
    expect(derivedOnly.data.fields.awards.derived).toBe(true);
    expect(derivedOnly.data.fields.awards.note).toBe("from image file name; confirm the award and year");

    const mixed = mergeFindings(ABOUT_V1, [
      finding("awards", [{ name: "Canadian Choice 2024" }], "https://x.com/canadian-choice-2024.png", HOME, { source: "image", confidence: 0.4, derived: true }),
      finding("awards", [{ name: "Canadian Choice Award 2024", issuer: "Canadian Choice Awards" }], "Canadian Choice Award 2024", FAQ),
    ]);
    expect(mixed.data.fields.awards.derived).toBeUndefined();
    expect(mixed.data.fields.awards.value).toHaveLength(2);
  });
});

describe("mergeFindings people", () => {
  const TEAM = "https://darcybaileycounselling.com/our-team/";
  const THERAPISTS = ["Nancy Orlikow", "Trish Rapske", "Aman Bains", "Julie Sprague", "Noah Molema"];
  const names = (value: FactValue) => (Array.isArray(value) ? value.map((item) => item.name) : []);

  it("does not join people who only share the team page as their url", () => {
    const { data } = mergeFindings(
      ABOUT_V1,
      THERAPISTS.map((name) => finding("team_members", [{ name, role: "Registered Clinical Counsellor", url: TEAM }], name, TEAM)),
    );
    expect(names(data.fields.team_members.value)).toEqual(THERAPISTS);
    expect(data.fields.team_members.itemConflicts).toBeUndefined();
  });

  it("does not join JSON-LD employees who share a url but not a name", () => {
    const { data } = mergeFindings(
      ABOUT_V1,
      THERAPISTS.map((name) => finding("team_members", [{ name, url: TEAM }], `{"name": "${name}"}`, HOME, { source: "jsonld" })),
    );
    expect(names(data.fields.team_members.value)).toEqual(THERAPISTS);
  });

  it("joins two full names through a shared profile url only when they share a name", () => {
    const profile = "https://darcybaileycounselling.com/palvinder-manhas/";
    const { data } = mergeFindings(ABOUT_V1, [
      finding("team_members", [{ name: "Pal Manhas", role: "Registered Clinical Counsellor", url: profile }], "Pal Manhas", TEAM),
      // The profile page gives itself as her url.
      finding("team_members", [{ name: "Palvinder Manhas-Bains", role: "Registered Clinical Counsellor", url: profile }], "Palvinder Manhas-Bains", profile),
      finding("team_members", [{ name: "Julie Sprague", role: "Registered Clinical Counsellor", url: profile }], "Julie Sprague", HOME),
    ]);
    expect(names(data.fields.team_members.value)).toEqual(["Pal Manhas", "Julie Sprague"]);
    expect(data.fields.team_members.itemConflicts?.map((c) => [c.key, c.on])).toEqual([["Pal Manhas", ["name"]]]);

    const apart = mergeFindings(ABOUT_V1, [
      finding("team_members", [{ name: "Pal Manhas", role: "Registered Clinical Counsellor" }], "Pal Manhas", TEAM),
      finding("team_members", [{ name: "Palvinder Manhas-Bains", role: "Registered Clinical Counsellor" }], "Palvinder Manhas-Bains", profile),
    ]);
    expect(names(apart.data.fields.team_members.value)).toEqual(["Pal Manhas", "Palvinder Manhas-Bains"]);
  });

  it("keeps two names read from one page's text apart, even a typo apart", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("team_members", [{ name: "Swetha Ranasuirya", role: "Registered Clinical Counsellor" }], "Swetha Ranasuirya", TEAM),
      finding("team_members", [{ name: "Swetha Ranasuriya", role: "Art Therapist" }], "Swetha Ranasuriya", TEAM),
    ]);
    expect(names(data.fields.team_members.value)).toEqual(["Swetha Ranasuirya", "Swetha Ranasuriya"]);
    // The same two spellings from JSON-LD and the text of one page are one person with a name conflict.
    const crossSource = mergeFindings(ABOUT_V1, [
      finding("team_members", [{ name: "Swetha Ranasuriya" }], '{"name": "Swetha Ranasuriya"}', TEAM, { source: "jsonld" }),
      finding("team_members", [{ name: "Swetha Ranasuirya" }], "Swetha Ranasuirya", TEAM),
    ]);
    expect(crossSource.data.fields.team_members.value).toHaveLength(1);
    expect(crossSource.data.fields.team_members.itemConflicts?.[0].on).toEqual(["name"]);
  });

  it("still joins a dropped middle initial and a first name on the same page", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("founders", [{ name: "Chris M. Walker", title: "Founder and CEO" }], "Chris M. Walker, Founder and CEO", ABOUT),
      finding("founders", [{ name: "Chris Walker", title: "Founder and CEO" }], "Chris Walker started Legiit", ABOUT),
      finding("founders", [{ name: "Jim Sabellico", title: "Co-founder and CTO" }], "Jim Sabellico, Co-founder and CTO", ABOUT),
      finding("founders", [{ name: "Jim", title: "Co-founder and CTO" }], "Jim runs engineering", ABOUT),
    ]);
    expect(names(data.fields.founders.value)).toEqual(["Chris M. Walker", "Jim Sabellico"]);
    expect(data.fields.founders.itemConflicts?.map((c) => c.key)).toEqual(["Chris M. Walker", "Jim Sabellico"]);
  });

  it("keeps different people with near names apart", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("team_members", [{ name: "Mark Bailey", role: "Therapist" }], "Mark Bailey", TEAM),
      finding("team_members", [{ name: "Mary Bailey", role: "Therapist" }], "Mary Bailey", `${TEAM}mary-bailey/`),
      finding("team_members", [{ name: "Chris Walker", role: "Therapist" }], "Chris Walker", TEAM),
      finding("team_members", [{ name: "Chris Walter", role: "Therapist" }], "Chris Walter", `${TEAM}chris-walter/`),
    ]);
    expect(names(data.fields.team_members.value)).toEqual(["Mark Bailey", "Mary Bailey", "Chris Walker", "Chris Walter"]);
  });
});

describe("mergeFindings social profile owners", () => {
  const BLOG = "https://legiit.com/blog/how-to-hire/";
  const link = (url: string, page: string): Finding =>
    finding("social_profiles", [{ platform: "youtube", url, owner: "" }], url, page, {
      source: "link",
      confidence: 0.8,
      derived: true,
      note: `linked from ${new URL(page).pathname.replace(/\/+$/, "") || "the home page"}; confirm whose profile this is`,
    });

  it("takes the owner from a Person node's sameAs and drops the link's caveat", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      link("https://www.youtube.com/@ChrisMWalker", ABOUT),
      finding("social_profiles", [{ platform: "youtube", url: "https://www.youtube.com/@ChrisMWalker", owner: "Chris M. Walker" }], "https://www.youtube.com/@ChrisMWalker", ABOUT, { source: "jsonld" }),
    ]);
    const social = data.fields.social_profiles;
    expect(social.value).toEqual([{ platform: "youtube", url: "https://www.youtube.com/@ChrisMWalker", owner: "Chris M. Walker" }]);
    expect(social.itemConflicts).toBeUndefined();
    expect(social.derived).toBeUndefined();
    expect(social.note).toBeUndefined();
  });

  it("gives a profile linked from two or more pages to the business, and leaves a one-page link unclaimed", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      link("https://www.youtube.com/@LegiitOfficial", HOME),
      link("https://www.youtube.com/@LegiitOfficial/", ABOUT),
      link("https://www.youtube.com/@GuestWriter", BLOG),
    ]);
    const social = data.fields.social_profiles;
    expect(social.value).toEqual([
      { platform: "youtube", url: "https://www.youtube.com/@LegiitOfficial", owner: "business" },
      { platform: "youtube", url: "https://www.youtube.com/@GuestWriter" },
    ]);
    expect(social.derived).toBeUndefined();
    expect(social.note).toBe("linked from /blog/how-to-hire; confirm whose profile this is");

    const unclaimed = mergeFindings(ABOUT_V1, [link("https://www.youtube.com/@GuestWriter", BLOG)]).data.fields.social_profiles;
    expect(unclaimed.derived).toBe(true);
  });

  it("never gives a LinkedIn personal profile to the business", () => {
    const personal = (page: string) =>
      finding("social_profiles", [{ platform: "linkedin", url: "https://www.linkedin.com/in/superstarseo/", owner: "" }], "https://www.linkedin.com/in/superstarseo/", page, { source: "link", derived: true });
    const { data } = mergeFindings(ABOUT_V1, [personal(HOME), personal(ABOUT)]);
    expect(data.fields.social_profiles.value).toEqual([{ platform: "linkedin", url: "https://www.linkedin.com/in/superstarseo/" }]);
    expect(data.fields.social_profiles.derived).toBe(true);
  });

  it("shows a conflict when the organization and a person both claim a profile", () => {
    const url = "https://www.instagram.com/cmwlegiit/";
    const { data } = mergeFindings(ABOUT_V1, [
      finding("social_profiles", [{ platform: "instagram", url, owner: "business" }], url, HOME, { source: "jsonld" }),
      finding("social_profiles", [{ platform: "instagram", url, owner: "Chris M. Walker" }], url, ABOUT, { source: "jsonld" }),
    ]);
    expect(data.fields.social_profiles.itemConflicts).toEqual([
      expect.objectContaining({ key: url, on: ["owner"] }),
    ]);
  });
});

describe("mergeFindings missing fields and stats", () => {
  it("gives every spec field without findings the missing shape", () => {
    const { data } = mergeFindings(ABOUT_V1, []);
    expect(Object.keys(data.fields)).toHaveLength(ABOUT_V1.fields.length);
    expect(data.templateId).toBe("about-v1");
    expect(data.fields.legal_name).toEqual({ value: null, status: "missing", evidence: [] });
    expect(data.fields.services).toEqual({ value: null, status: "missing", evidence: [] });
  });

  it("counts statuses, required gaps, pages, and findings", () => {
    const findings = [
      finding("company_name", "Legiit", "About Legiit", ABOUT),
      finding("years_in_business", "17+ years", "17+ years", HOME),
      finding("years_in_business", "19+ years", "19+ years", FAQ),
      finding("competitors", [{ name: "Fiverr" }], "Fiverr", ABOUT),
    ];
    const { stats } = mergeFindings(ABOUT_V1, findings, { droppedCount: 4 });
    expect(stats.found).toBe(2);
    expect(stats.conflict).toBe(1);
    expect(stats.userProvided).toBe(0);
    expect(stats.missing).toBe(ABOUT_V1.fields.length - 3);
    const required = ABOUT_V1.fields.filter((f) => f.required).length;
    expect(stats.requiredMissing).toBe(required - 1);
    expect(stats.pagesUsed).toBe(3);
    expect(stats.findingsTotal).toBe(8);
    expect(stats.findingsDropped).toBe(4);

    const { stats: explicit } = mergeFindings(ABOUT_V1, findings, { pagesUsed: 12 });
    expect(explicit.pagesUsed).toBe(12);
    expect(explicit.findingsTotal).toBe(4);
  });

  it("recomputes stats from an edited sheet and carries the counters over", () => {
    const { data, stats } = mergeFindings(ABOUT_V1, [finding("company_name", "Legiit", "About Legiit", ABOUT)], { droppedCount: 2 });
    data.fields.category = applyUserEdit(data.fields.category, { value: "curated freelance marketplace" }, "2026-11-05T00:00:00.000Z");
    const next = recomputeStats(ABOUT_V1, data, stats);
    expect(next.userProvided).toBe(1);
    expect(next.found).toBe(1);
    expect(next.requiredMissing).toBe(stats.requiredMissing - 1);
    expect(next.findingsDropped).toBe(2);
    expect(next.pagesUsed).toBe(1);
  });
});

describe("applyUserEdit", () => {
  const at = "2026-11-05T12:00:00.000Z";

  it("resolves a scalar conflict with pickCandidate, keeps the crawled state, and clear restores it", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("years_in_business", "17+ years", "17+ years", HOME),
      finding("years_in_business", "19+ years", "19+ years", FAQ),
      finding("years_in_business", "19+ years", "19+ years here", CONTACT),
    ]);
    const before = data.fields.years_in_business;
    const picked = applyUserEdit(before, { pickCandidate: 1 }, at);
    expect(picked.status).toBe("user_provided");
    expect(picked.value).toBe("17+ years");
    expect(picked.evidence).toEqual([{ quote: "17+ years", url: HOME, source: "page" }]);
    expect(picked.candidates).toBeUndefined();
    expect(picked.updatedAt).toBe(at);
    expect(picked.crawled).toEqual({
      value: "19+ years",
      status: "conflict",
      evidence: before.evidence,
      candidates: before.candidates,
    });
    // The input was not mutated.
    expect(before.status).toBe("conflict");

    const cleared = applyUserEdit(picked, { clear: true }, () => "2026-11-06T00:00:00.000Z");
    expect(cleared.status).toBe("conflict");
    expect(cleared.value).toBe("19+ years");
    expect(cleared.candidates).toEqual(before.candidates);
    expect(cleared.crawled).toBeUndefined();
    expect(cleared.updatedAt).toBe("2026-11-06T00:00:00.000Z");
  });

  it("stores a typed value with user evidence and a note, snapshotting a missing field", () => {
    const { data } = mergeFindings(ABOUT_V1, []);
    const edited = applyUserEdit(
      data.fields.headquarters,
      {
        value: { streetAddress: "2411 N. Oak Street 105E", addressLocality: "Myrtle Beach", addressRegion: "SC", postalCode: "29577", addressCountry: "US", text: "2411 N. Oak Street 105E, Myrtle Beach, SC 29577, USA" },
        note: "Not Las Vegas. Confirmed by the owner.",
      },
      at,
    );
    expect(edited.status).toBe("user_provided");
    expect(edited.evidence).toEqual([
      { quote: "2411 N. Oak Street 105E, Myrtle Beach, SC 29577, USA", url: "", source: "user" },
    ]);
    expect(edited.note).toBe("Not Las Vegas. Confirmed by the owner.");
    expect(edited.crawled).toEqual({ value: null, status: "missing", evidence: [] });

    const again = applyUserEdit(edited, { value: "remote" }, at);
    expect(again.crawled).toEqual({ value: null, status: "missing", evidence: [] });
    expect(again.evidence).toHaveLength(2);
  });

  it("resolves an item conflict with pickItemCandidate", () => {
    const { data } = mergeFindings(ABOUT_V1, [
      finding("founders", [{ name: "Jim", title: "Co-founder and CTO", url: "https://legiit.com/team/jim" }], '"name": "Jim"', ABOUT, { source: "jsonld" }),
      finding("founders", [{ name: "Jim Sabellico", title: "Co-founder and CTO", url: "https://legiit.com/team/jim", linkedin: "https://www.linkedin.com/in/jimsabellico/" }], "Jim Sabellico, Co-founder and CTO", ABOUT),
      finding("founders", [{ name: "Chris M. Walker", title: "Founder and CEO" }], "Chris M. Walker, Founder and CEO", ABOUT),
    ]);
    const before = data.fields.founders;
    expect(before.itemConflicts?.[0].key).toBe("Jim");
    const edited = applyUserEdit(before, { pickItemCandidate: { conflictKey: "Jim", index: 1 } }, at);
    expect(edited.status).toBe("user_provided");
    expect(edited.value).toEqual([
      { name: "Jim Sabellico", title: "Co-founder and CTO", url: "https://legiit.com/team/jim", linkedin: "https://www.linkedin.com/in/jimsabellico/" },
      { name: "Chris M. Walker", title: "Founder and CEO" },
    ]);
    expect(edited.itemConflicts).toBeUndefined();
    expect(edited.crawled?.status).toBe("found");
    expect(() => applyUserEdit(before, { pickItemCandidate: { conflictKey: "Nobody", index: 0 } }, at)).toThrow();
    expect(() => applyUserEdit(before, { pickCandidate: 0 }, at)).toThrow();
  });
});
