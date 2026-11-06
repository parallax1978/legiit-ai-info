/*
  The deterministic copy linter. It walks every text of a page draft and
  reports, against the writing rules in docs/build-spec.md, what the rewrite
  prompt can fix: banned words, dashes, numbers that are not in the fact
  sheet, FAQ count and length, long sentences, exclamation marks, first
  person, placeholders, and empty entries. Pure: no I/O, no model, no
  randomness, and fast enough to run on every rewrite pass.

  A paragraph that starts with "> " is a verbatim quote. Its words are the
  speaker's, so it is exempt from the voice rules (banned words, first person,
  exclamation marks, dashes, sentence length) but not from the fact rules
  (numbers, placeholders, empty).

  A banned word is also let through inside a name from the fact sheet
  ("Premier Roofing") and inside a phrase from a field's allowlist in the
  template (a modality a counselling practice really offers).
*/
import type { FactSheetData, FactValue } from "@/lib/facts/types";
import type { TemplateSpec } from "@/templates/types";
import type { DraftFaq, DraftItem, LintIssue, LintKind, LintReport, PageDraft } from "./types";

/** Words and phrases the page never uses, lower case; a field's allowlist exempts a word in that field's text. */
export const BANNED: readonly string[] = [
  "leverage", "leverages", "leveraged", "leveraging", "cutting-edge", "cutting edge", "state-of-the-art",
  "state of the art", "world-class", "world class", "best-in-class", "best in class", "seamless", "seamlessly",
  "unlock", "unlocks", "unlocking", "unleash", "unleashes", "unleashing", "empower", "empowers", "empowered",
  "empowering", "empowerment", "elevate", "elevates", "elevating", "synergy", "synergies", "game-changing",
  "game changing", "game changer", "game-changer", "gamechanger", "robust", "innovative", "innovation",
  "innovations", "passionate", "passion", "delve", "tapestry", "testament", "holistic", "transformative",
  "transformational", "journey", "journeys", "safe space", "nurturing", "bespoke", "curated", "revolutionary",
  "disruptive", "next-level", "next level", "supercharge", "supercharges", "supercharged", "turbocharge",
  "turbocharged", "streamline", "streamlines", "streamlined", "streamlining", "frictionless", "effortless",
  "thrilled", "excited", "dream", "dreams", "vibrant", "dynamic", "top-notch", "top notch", "premier",
  "premium quality", "unparalleled", "unmatched", "exceptional", "outstanding", "look no further",
  "in today's fast-paced world", "fast-paced", "fast paced", "at the end of the day", "we pride ourselves",
  "we understand", "whether you're", "whether you are", "rest assured", "needless to say", "it's no secret",
  "in a nutshell", "the bottom line", "comprehensive solution", "one-stop shop", "one stop shop", "one-stop-shop",
  "tailored to your needs", "take your business to the next level",
];

/** Over this many words a sentence is reported; the rules ask for under about 30. */
const LONG_SENTENCE_WORDS = 40;

const WORD_CHAR = /[0-9A-Za-zÀ-ɏ]/;
const CURLY_SINGLE_QUOTES = /[‘’‚‛′ʼ´]/g;
const ODD_SPACES = /[   -   　]/g;
const EM_DASH = /[—―]/;
const SPACED_EN_DASH = /\s–\s/;
const FIRST_PERSON = /\b(?:we|our|ours|us|ourselves)\b/gi;
/** A number as people write it: digits, thousands groups with commas, an optional decimal part. */
const NUMBER = /\d+(?:,\d{3})*(?:\.\d+)?/g;
const PLACEHOLDERS: readonly RegExp[] = [
  /\[insert/i,
  /\[company\]/i,
  /lorem ipsum/i,
  /\blorem\b/i,
  /\{\{/,
  /\bTBD\b/,
  /\bTODO\b/,
  /\bXXX+\b/i,
];
/** Terminal punctuation, with any closing quote or bracket, before whitespace or the end. */
const TERMINAL = /[.!?]+["')\]]*(?=\s|$)/g;
/** A full stop after one of these does not end a sentence. "no" is handled apart: "No. 5" is a number, "No. It is not." is two sentences. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "inc", "ltd", "llc", "co", "corp",
  "approx", "dept", "est", "ave", "blvd", "rd",
]);
/** Scalar fields whose value is a name of the business. List items contribute their "name" key. */
const NAME_FIELDS = new Set(["company_name", "legal_name", "alternate_names"]);
const BANNED_RE = phraseRegex(BANNED) ?? /(?!)/g;

type Span = readonly [start: number, end: number];

interface Context {
  /** Every number in the fact sheet, as a comparison key. */
  numbers: ReadonlySet<string>;
  /** Names from the fact sheet and the template's allowlisted phrases; a banned word inside one is fine. */
  exempt: RegExp | null;
  issues: LintIssue[];
  seen: Set<string>;
}

export function lintDraft(draft: PageDraft, data: FactSheetData, spec: TemplateSpec): LintReport {
  const ctx: Context = {
    numbers: factNumbers(data),
    exempt: phraseRegex([...allowlisted(spec), ...namesIn(data, spec)]),
    issues: [],
    seen: new Set(),
  };
  checkText(ctx, "metaTitle", draft.metaTitle);
  checkText(ctx, "metaDescription", draft.metaDescription);
  checkText(ctx, "title", draft.title);
  checkTexts(ctx, "intro", draft.intro);
  checkItems(ctx, "offerings", draft.offerings);
  checkItems(ctx, "differentiators", draft.differentiators);
  checkTexts(ctx, "customers", draft.customers);
  checkItems(ctx, "founders", draft.founders);
  checkTexts(ctx, "originStory", draft.originStory);
  checkItems(ctx, "team", draft.team);
  checkTexts(ctx, "teamSummary", draft.teamSummary);
  checkTexts(ctx, "process", draft.process);
  checkFaq(ctx, draft.faq, spec.faq);
  checkTexts(ctx, "closing", draft.closing);
  return { passed: ctx.issues.length === 0, issues: ctx.issues, attempts: 0 };
}

/* ---------- the walk ---------- */

function checkTexts(ctx: Context, where: string, texts: string[] | undefined): void {
  (texts ?? []).forEach((text, i) => checkText(ctx, `${where}[${i}]`, text));
}

function checkItems(ctx: Context, where: string, items: DraftItem[] | undefined): void {
  (items ?? []).forEach((item, i) => {
    const at = `${where}[${i}]`;
    checkText(ctx, `${at}.heading`, item.heading);
    const paragraphs = item.paragraphs ?? [];
    if (paragraphs.length === 0) report(ctx, `${at}.paragraphs`, "empty", "", "write the text or remove the entry");
    paragraphs.forEach((p, j) => checkText(ctx, `${at}.paragraphs[${j}]`, p));
    (item.links ?? []).forEach((link, k) => checkText(ctx, `${at}.links[${k}].label`, link.label));
  });
}

function checkFaq(ctx: Context, faq: DraftFaq[] | undefined, rules: TemplateSpec["faq"]): void {
  const entries = faq ?? [];
  const n = entries.length;
  if (n < rules.min) {
    report(ctx, "faq", "faq_count", `${n} questions`, `add questions answered by facts on the page until there are at least ${rules.min}`);
  } else if (n > rules.max) {
    report(ctx, "faq", "faq_count", `${n} questions`, `cut the list to at most ${rules.max} questions`);
  }
  entries.forEach((entry, i) => {
    checkText(ctx, `faq[${i}].question`, entry.question);
    const where = `faq[${i}].answer`;
    if (!checkText(ctx, where, entry.answer)) return;
    const count = sentences(entry.answer).length;
    if (count < rules.answerSentencesMin || count > rules.answerSentencesMax) {
      report(
        ctx,
        where,
        "faq_length",
        short(entry.answer),
        `answer in ${rules.answerSentencesMin} to ${rules.answerSentencesMax} sentences; this one has ${count}`,
      );
    }
  });
}

/** Runs every rule on one text. Returns false when the text is empty, so the caller skips rules that need text. */
function checkText(ctx: Context, where: string, raw: string | undefined): boolean {
  const original = raw ?? "";
  const quote = original.startsWith("> ");
  const text = straighten(quote ? original.slice(2) : original);
  if (text.trim() === "") {
    report(ctx, where, "empty", "", "write the text or remove the entry");
    return false;
  }

  for (const re of PLACEHOLDERS) {
    const m = re.exec(text);
    if (m) {
      report(ctx, where, "placeholder", m[0], `replace the placeholder '${m[0]}' with the fact, or drop the sentence`);
      break;
    }
  }

  const exempt = ctx.exempt ? spans(text, ctx.exempt) : [];
  const banned: Span[] = [];
  if (!quote) {
    for (const m of text.matchAll(BANNED_RE)) {
      const at = m.index ?? 0;
      const span: Span = [at, at + m[0].length];
      if (inside(span, exempt)) continue;
      banned.push(span);
      report(ctx, where, "banned_word", m[0], `replace '${m[0].toLowerCase()}' with a plain word`);
    }
    for (const m of text.matchAll(FIRST_PERSON)) {
      if (m[0] === "US") continue; // the country, not us
      const at = m.index ?? 0;
      const span: Span = [at, at + m[0].length];
      if (inside(span, exempt) || inside(span, banned)) continue;
      report(ctx, where, "first_person", m[0], `write in the third person, by name, instead of '${m[0].toLowerCase()}'`);
    }
    const dash = EM_DASH.exec(text) ?? SPACED_EN_DASH.exec(text);
    if (dash) {
      const at = dash.index + dash[0].indexOf(dash[0].trim());
      report(ctx, where, "dash", around(text, at), "replace the dash with a comma, a colon, or a full stop");
    }
    const bang = text.indexOf("!");
    if (bang >= 0) report(ctx, where, "exclamation", around(text, bang), "end the sentence with a full stop");
    for (const sentence of sentences(text)) {
      const words = wordCount(sentence);
      if (words > LONG_SENTENCE_WORDS) {
        report(ctx, where, "long_sentence", short(sentence), `split this ${words}-word sentence in two; keep sentences under 30 words`);
      }
    }
  }

  for (const m of text.matchAll(NUMBER)) {
    if (ctx.numbers.has(numberKey(m[0]))) continue;
    report(ctx, where, "invented_number", m[0], `the number ${m[0]} is not in the fact sheet; use one that is, or drop it`);
  }
  return true;
}

function report(ctx: Context, where: string, kind: LintKind, text: string, hint: string): void {
  const key = `${where}\u0000${kind}\u0000${text.toLowerCase()}`;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  ctx.issues.push({ where, kind, text, hint });
}

/* ---------- the fact sheet ---------- */

/** Every number in the fact sheet's values and quotes, conflict candidates and list items included. */
function factNumbers(data: FactSheetData): Set<string> {
  const keys = new Set<string>();
  for (const s of factStrings(data)) for (const m of s.matchAll(NUMBER)) keys.add(numberKey(m[0]));
  return keys;
}

function* factStrings(data: FactSheetData): Generator<string> {
  for (const field of Object.values(data.fields ?? {})) {
    yield* valueStrings(field.value);
    for (const e of field.evidence ?? []) yield e.quote;
    for (const c of field.candidates ?? []) {
      yield* valueStrings(c.value);
      for (const e of c.evidence ?? []) yield e.quote;
    }
    for (const conflict of field.itemConflicts ?? []) {
      yield conflict.key;
      for (const c of conflict.candidates ?? []) {
        yield* valueStrings(c.value);
        for (const e of c.evidence ?? []) yield e.quote;
      }
    }
  }
}

function* valueStrings(value: FactValue | undefined): Generator<string> {
  if (typeof value === "string") {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) for (const v of Object.values(item ?? {})) if (typeof v === "string") yield v;
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) if (typeof v === "string") yield v;
  }
}

/** Names of the business and of the things and people in its lists: a banned word inside one is the name, not a buzzword. */
function namesIn(data: FactSheetData, spec: TemplateSpec): string[] {
  const names: string[] = [];
  for (const [id, field] of Object.entries(data.fields ?? {})) {
    const value = field.value;
    if (typeof value === "string") {
      if (NAME_FIELDS.has(id)) names.push(value);
      continue;
    }
    if (!Array.isArray(value)) continue;
    // A "name" the model writes in its own words (a policy's heading) is not a name.
    const shape = spec.fields.find((f) => f.id === id)?.itemShape?.find((k) => k.key === "name");
    if (shape?.wording === "summary") continue;
    for (const item of value) {
      const name = item?.name;
      if (typeof name === "string") names.push(name);
    }
  }
  return names.map((n) => n.trim()).filter((n) => n.length > 1);
}

function allowlisted(spec: TemplateSpec): string[] {
  return spec.fields.flatMap((f) => f.allowlist ?? []);
}

/* ---------- text helpers ---------- */

/** Straight apostrophes and plain spaces, so "you’re" matches "you're". Dashes are kept: the dash rule needs them. */
function straighten(s: string): string {
  return s.replace(CURLY_SINGLE_QUOTES, "'").replace(ODD_SPACES, " ");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One case-insensitive regex that finds any of the phrases as whole words, longest first. */
function phraseRegex(phrases: readonly string[]): RegExp | null {
  const unique = Array.from(new Set(phrases.map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0)));
  if (unique.length === 0) return null;
  unique.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  const alternatives = unique.map((p) => {
    const head = WORD_CHAR.test(p.charAt(0)) ? "\\b" : "";
    const tail = WORD_CHAR.test(p.charAt(p.length - 1)) ? "\\b" : "";
    return `${head}${escapeRe(p)}${tail}`;
  });
  return new RegExp(`(?:${alternatives.join("|")})`, "gi");
}

function spans(text: string, re: RegExp): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    out.push([at, at + m[0].length]);
  }
  return out;
}

function inside(span: Span, others: readonly Span[]): boolean {
  return others.some(([s, e]) => span[0] >= s && span[1] <= e);
}

/** "4,000" and "4000" and "04000" are one number; "1.50" is "1.5". */
function numberKey(token: string): string {
  const [whole = "", fraction = ""] = token.replace(/,/g, "").split(".");
  const int = whole.replace(/^0+(?=\d)/, "");
  const frac = fraction.replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

function wordCount(s: string): number {
  let n = 0;
  for (const token of s.split(/\s+/)) if (WORD_CHAR.test(token)) n += 1;
  return n;
}

/** Sentences by terminal punctuation. Initials ("Chris M. Walker"), common abbreviations, and decimals do not end one. */
function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(TERMINAL)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (end < text.length && !endsSentence(text, start, at, end)) continue;
    const sentence = text.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function endsSentence(text: string, start: number, punctAt: number, end: number): boolean {
  const next = text.slice(end).trimStart().charAt(0);
  if (!next) return true;
  // The next sentence opens with a capital, a digit, a quote, a bracket, or a currency sign.
  if (!/[A-Z0-9"'(\[$£€]/.test(next)) return false;
  if (text.charAt(punctAt) !== ".") return true;
  const lastWord = (/(\S+)$/.exec(text.slice(start, punctAt))?.[1] ?? "").replace(/^["'(\[]+/, "");
  // An initial or a dotted abbreviation: "M" in "Chris M. Walker", "e.g", "a.m".
  if (/^(?:[A-Za-z]\.)*[A-Za-z]$/.test(lastWord)) return false;
  const bare = lastWord.toLowerCase();
  if (bare === "no") return !/[0-9]/.test(next);
  return !ABBREVIATIONS.has(bare);
}

/** The first characters of a text, for an issue's text. */
function short(s: string, max = 100): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`;
}

/** The text around a position, for an issue's text. */
function around(s: string, at: number, reach = 30): string {
  const start = Math.max(0, at - reach);
  const end = Math.min(s.length, at + reach);
  return `${start > 0 ? "..." : ""}${s.slice(start, end).trim()}${end < s.length ? "..." : ""}`;
}
