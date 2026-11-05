/*
  Prompts for the per-page extraction call. The system prompt depends only on
  the template spec, so it is byte-for-byte stable across pages and the prompt
  cache applies to it. Everything that changes per page goes in the user prompt.
*/
import type { TemplateField, TemplateSpec } from "@/templates/types";

function describeField(field: TemplateField): string {
  let shape: string;
  if (field.type === "list") {
    const keys = (field.itemShape ?? []).map((s) => {
      const bits = [s.key];
      if (s.required) bits.push("required");
      if (s.hint) bits.push(`for example "${s.hint}"`);
      return bits.length > 1 ? `${bits[0]} (${bits.slice(1).join("; ")})` : bits[0];
    });
    shape = keys.length ? `list; item keys: ${keys.join(", ")}` : "list";
  } else if (field.type === "address") {
    shape = `address; keys: ${(field.addressKeys ?? []).join(", ")}`;
  } else {
    shape = field.type;
  }
  const example = field.example ? ` Example: ${field.example}` : "";
  return `- ${field.id} (${shape}): ${field.lookFor}${example}`;
}

export function buildSystemPrompt(spec: TemplateSpec): string {
  const sections = [...spec.sections].sort((a, b) => a.order - b.order);
  const fieldLines: string[] = [];
  for (const section of sections) {
    const fields = spec.fields.filter((f) => f.section === section.id);
    if (!fields.length) continue;
    fieldLines.push(`${section.title}:`);
    for (const f of fields) fieldLines.push(describeField(f));
    fieldLines.push("");
  }
  for (const f of spec.fields) {
    if (!sections.some((s) => s.id === f.section)) fieldLines.push(describeField(f));
  }

  return [
    `You read one page of a business website and report every fact on it that matches one of the fields below. The fields are the inputs for a "${spec.name}" page. Another program checks each quote against the page text and merges the findings from every page of the site, so report what this page states and nothing more.`,
    "",
    "Rules",
    "- One finding per fact. A page can give several findings for the same field (two prices, two spellings of a name, a date and a years-in-business claim). Report each one; do not pick between them.",
    "- Every finding carries a quote copied from the page text character for character: no paraphrase, no ellipsis, no added or dropped words, at most 300 characters. The quote must contain the fact. A finding whose quote cannot be found in the page text is thrown away, so a short exact quote beats a long approximate one.",
    "- Never invent, never fill in from general knowledge, never report a field without a quote. If the page does not state it, leave it out.",
    "- Prefer specific numbers, names, dates, prices, places, and credentials over general statements and slogans.",
    '- kind "scalar": put the fact in value as a short string and leave item empty. Keep the page\'s own wording; do not rewrite it into a sentence.',
    '- kind "list_item": one finding per item. Put the item keys in item and leave value empty. Fill the keys the page supports and leave the others out. Required keys must be present.',
    '- kind "address": value is the address on one line as the page writes it. item carries streetAddress, addressLocality, addressRegion, postalCode, and addressCountry where the page gives them.',
    "- confidence is 0 to 1: 0.9 or above when the page states the fact plainly for this field, lower when it is implied, partial, or could belong to a different field. Be honest.",
    "- note is usually an empty string. Use it when the page contradicts itself or another finding on the same page, or when a value needs a caveat.",
    "- founded_date takes dates and years (\"since 2018\", \"founded in 2006\"). A claim like \"17 years in business\" goes to years_in_business, not to founded_date.",
    `- business_type takes exactly one value from this list, the single best fit: ${spec.schema.orgTypes.join(", ")}.`,
    "- Phone numbers, email addresses, and social links that appear only as links are read separately; report them when the page text shows them.",
    "- page_summary: one sentence on what this page is.",
    "- business_name_guess: the name the business calls itself on this page, or an empty string.",
    "",
    "Fields, as field_id (type, list keys if any): what to look for",
    "",
    ...fieldLines,
  ]
    .join("\n")
    .trimEnd();
}

export interface UserPromptInput {
  url: string;
  title: string | null;
  text: string;
  existingJsonLdTypes: string[];
}

export function buildUserPrompt(input: UserPromptInput): string {
  const types = input.existingJsonLdTypes.filter(Boolean);
  const title = (input.title ?? "").trim();
  return [
    `Page URL: ${input.url}`,
    `Title: ${title || "(none)"}`,
    `JSON-LD types already on this page: ${types.length ? types.join(", ") : "none"}. Their values are read separately; still report the facts the visible text states.`,
    "",
    "Page text, between the markers:",
    "<<<PAGE",
    input.text,
    "PAGE>>>",
    "",
    "Report the findings for this page. Quote only from the page text between the markers.",
  ].join("\n");
}
