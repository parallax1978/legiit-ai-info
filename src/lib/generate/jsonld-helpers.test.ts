import { describe, expect, it } from "vitest";
import { countryCode, nonFounders } from "./jsonld";

describe("countryCode", () => {
  it("gives the ISO code for the names people write, and leaves codes and unknown names alone", () => {
    expect(countryCode("USA")).toBe("US");
    expect(countryCode("United States")).toBe("US");
    expect(countryCode("U.S.A.")).toBe("US");
    expect(countryCode("ca")).toBe("CA");
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("Narnia")).toBe("Narnia");
    expect(countryCode("")).toBe("");
  });
});

describe("nonFounders", () => {
  it("leaves out team members who are already founders, by name, including a middle initial", () => {
    const founders = [{ name: "Chris M. Walker" }, { name: "Jim Sabellico" }];
    const team = [{ name: "Jim Sabellico", role: "CTO" }, { name: "Chris Walker", role: "CEO" }, { name: "Jessica Lavatai", role: "COO" }];
    expect(nonFounders(team, founders).map((t) => t.name)).toEqual(["Jessica Lavatai"]);
    expect(nonFounders(team, [])).toHaveLength(3);
  });
});
