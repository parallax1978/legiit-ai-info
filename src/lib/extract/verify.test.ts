import { describe, expect, it } from "vitest";
import type { Finding } from "@/lib/facts/types";
import { normalizeForMatch, verifyFindings, verifyQuote } from "./verify";

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

  it("accepts a long quote whose first 80 characters match, and only then", () => {
    const start =
      "Legiit is a curated freelance marketplace where business owners and agencies buy SEO, content, design";
    expect(start.length).toBeGreaterThan(80);
    expect(verifyQuote(`${start} and other things the model made up`, PAGE)).toBe(true);
    // Under 80 characters there is no prefix rule.
    expect(verifyQuote("It launched on February 7, 2018 and then it made up a tail", PAGE)).toBe(false);
    // A long quote whose start is wrong fails.
    expect(verifyQuote(`Our marketplace ${start}`, PAGE)).toBe(false);
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
