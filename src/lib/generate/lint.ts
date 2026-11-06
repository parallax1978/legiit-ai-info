/*
  The deterministic copy linter. See docs/build-spec.md for the rules. The
  lint builder replaces the stub; BANNED is the contract for the word list.
*/
import type { FactSheetData } from "@/lib/facts/types";
import type { TemplateSpec } from "@/templates/types";
import type { LintReport, PageDraft } from "./types";

/** Words and phrases the page never uses, lower case; a field's allowlist exempts a word in that field's text. */
export const BANNED: readonly string[] = [
  "leverage", "leveraging", "cutting-edge", "cutting edge", "state-of-the-art", "state of the art", "world-class",
  "world class", "best-in-class", "best in class", "seamless", "seamlessly", "unlock", "unleash", "empower",
  "empowering", "elevate", "synergy", "synergies", "game-changing", "game changer", "robust", "innovative",
  "innovation", "passionate", "passion", "delve", "tapestry", "testament", "holistic", "transformative",
  "transformational", "journey", "safe space", "nurturing", "bespoke", "curated", "revolutionary", "disruptive",
  "next-level", "next level", "supercharge", "turbocharge", "streamline", "frictionless", "effortless", "thrilled",
  "excited", "dream", "vibrant", "dynamic", "top-notch", "top notch", "premier", "premium quality", "unparalleled",
  "unmatched", "exceptional", "outstanding", "look no further", "in today's fast-paced world", "at the end of the day",
  "we pride ourselves", "we understand", "whether you're", "rest assured", "needless to say", "it's no secret",
  "in a nutshell", "the bottom line", "comprehensive solution", "one-stop shop", "tailored to your needs",
  "take your business to the next level",
];

export function lintDraft(draft: PageDraft, data: FactSheetData, spec: TemplateSpec): LintReport {
  void draft;
  void data;
  void spec;
  return { passed: true, issues: [], attempts: 0 };
}
