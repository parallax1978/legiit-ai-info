/*
  The model's structured output and its conversion to Finding objects.

  Structured outputs need a closed object schema, so list items are an array of
  {key, value} pairs rather than a record, and every property is required (an
  empty string or array stands in for "not applicable").
*/
import { z } from "zod";
import type { AddressValue, Finding, ListItem } from "@/lib/facts/types";
import type { TemplateField, TemplateSpec } from "@/templates/types";

export const ADDRESS_KEYS = [
  "streetAddress",
  "addressLocality",
  "addressRegion",
  "postalCode",
  "addressCountry",
] as const;

export type AddressKey = (typeof ADDRESS_KEYS)[number];

/** Findings the model is less sure about than this are dropped before verification. */
export const MIN_CONFIDENCE = 0.2;

export const ItemPairSchema = z.object({
  key: z.string().describe("An item key from the field's key list."),
  value: z.string().describe("The value for that key, as the page states it."),
});

export const ExtractionFindingSchema = z.object({
  field_id: z.string().describe("A field id from the field list, exactly as written there."),
  // A plain string, not z.enum: the strict-schema transform moves enums into
  // the description, so the API does not enforce them, and a stray value must
  // not fail the whole page. toFindings decides by the field's type anyway.
  kind: z
    .string()
    .describe(
      'One of "scalar", "list_item", "address": scalar for a single value, list_item for one item of a list field, address for the address field.',
    ),
  value: z
    .string()
    .describe(
      "scalar: the fact as a short string. address: the whole address on one line as the page writes it. list_item: an empty string.",
    ),
  item: z
    .array(ItemPairSchema)
    .describe("list_item: the item's keys and values. address: the address parts. scalar: an empty array."),
  quote: z
    .string()
    .describe(
      "Text copied from the page character for character that contains the fact. No paraphrase, no ellipsis, at most 300 characters.",
    ),
  confidence: z
    .number()
    .describe("0 to 1. How sure you are that the quote states this fact for this field."),
  note: z
    .string()
    .describe("Usually an empty string. A short note when the page contradicts itself or the value needs a caveat."),
});

export const ExtractionOutputSchema = z.object({
  findings: z.array(ExtractionFindingSchema),
  page_summary: z.string().describe("One sentence on what this page is."),
  business_name_guess: z
    .string()
    .describe("The name the business calls itself on this page, or an empty string."),
});

export type FindingKind = "scalar" | "list_item" | "address";
export type ExtractionFinding = z.infer<typeof ExtractionFindingSchema>;
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

/** Keys the model may use for address parts, mapped onto the schema.org names. */
const ADDRESS_ALIASES: Record<string, AddressKey> = {
  streetaddress: "streetAddress",
  street: "streetAddress",
  street_address: "streetAddress",
  address: "streetAddress",
  addresslocality: "addressLocality",
  locality: "addressLocality",
  city: "addressLocality",
  town: "addressLocality",
  addressregion: "addressRegion",
  region: "addressRegion",
  state: "addressRegion",
  province: "addressRegion",
  postalcode: "postalCode",
  postal_code: "postalCode",
  postal: "postalCode",
  postcode: "postalCode",
  zip: "postalCode",
  zip_code: "postalCode",
  zipcode: "postalCode",
  addresscountry: "addressCountry",
  country: "addressCountry",
};

type Pair = { key: string; value: string };

function cleanPairs(pairs: ExtractionFinding["item"] | undefined): Pair[] {
  if (!Array.isArray(pairs)) return [];
  const out: Pair[] = [];
  for (const p of pairs) {
    const key = typeof p?.key === "string" ? p.key.trim() : "";
    const value = typeof p?.value === "string" ? p.value.trim() : "";
    if (key && value) out.push({ key, value });
  }
  return out;
}

function clampConfidence(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** One list item from the model's pairs, restricted to the field's item shape. */
function listItemFromPairs(field: TemplateField, pairs: Pair[], fallbackValue: string): ListItem | null {
  const shape = field.itemShape ?? [];
  const allowed = new Map(shape.map((s) => [s.key.toLowerCase(), s.key]));
  const item: ListItem = {};
  for (const p of pairs) {
    const key = shape.length ? allowed.get(p.key.toLowerCase()) : p.key;
    if (!key || item[key] !== undefined) continue;
    item[key] = p.value;
  }
  if (Object.keys(item).length === 0 && fallbackValue && shape.length) {
    // The model put the whole item into value. Treat it as the first key.
    item[shape[0].key] = fallbackValue;
  }
  if (Object.keys(item).length === 0) return null;
  for (const s of shape) {
    if (s.required && !item[s.key]) return null;
  }
  return item;
}

export function joinAddressParts(a: AddressValue): string {
  return ADDRESS_KEYS.map((k) => a[k])
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(", ");
}

function addressFromPairs(pairs: Pair[], text: string): AddressValue | null {
  const addr: AddressValue = {};
  for (const p of pairs) {
    const key = ADDRESS_ALIASES[p.key.toLowerCase().replace(/[\s-]+/g, "_")] ?? ADDRESS_ALIASES[p.key.toLowerCase()];
    if (!key || addr[key]) continue;
    addr[key] = p.value;
  }
  const line = text || joinAddressParts(addr);
  if (!line) return null;
  addr.text = line;
  return addr;
}

function scalarValue(raw: ExtractionFinding, pairs: Pair[]): string | null {
  const value = typeof raw.value === "string" ? raw.value.trim() : "";
  if (value) return value;
  const joined = pairs.map((p) => p.value).join(", ");
  return joined || null;
}

/**
 * Converts the model's output for one page into Finding objects. Drops findings
 * whose field id is not in the spec, whose quote is empty, or whose confidence
 * is under MIN_CONFIDENCE. Quotes are verified separately (verify.ts).
 */
export function toFindings(output: ExtractionOutput, opts: { url: string; spec: TemplateSpec }): Finding[] {
  const byId = new Map<string, TemplateField>();
  for (const f of opts.spec.fields) byId.set(f.id.toLowerCase(), f);

  const out: Finding[] = [];
  for (const raw of output?.findings ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.field_id === "string" ? raw.field_id.trim().toLowerCase() : "";
    const field = byId.get(id);
    if (!field) continue;
    const quote = typeof raw.quote === "string" ? raw.quote.trim() : "";
    if (!quote) continue;
    const confidence = clampConfidence(raw.confidence);
    if (confidence < MIN_CONFIDENCE) continue;

    const pairs = cleanPairs(raw.item);
    const textValue = typeof raw.value === "string" ? raw.value.trim() : "";
    let value: Finding["value"];
    if (field.type === "list") {
      const item = listItemFromPairs(field, pairs, textValue);
      if (!item) continue;
      value = [item];
    } else if (field.type === "address") {
      const addr = addressFromPairs(pairs, textValue);
      if (!addr) continue;
      value = addr;
    } else {
      const v = scalarValue(raw, pairs);
      if (!v) continue;
      value = v;
    }

    const note = typeof raw.note === "string" ? raw.note.trim() : "";
    const finding: Finding = {
      fieldId: field.id,
      value,
      quote,
      url: opts.url,
      source: "page",
      confidence,
    };
    if (note) finding.note = note;
    out.push(finding);
  }
  return out;
}
