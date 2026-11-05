/*
  The page spec is data. `about-v1` lives in ./about-v1.ts and is also stored in
  the `templates` table so new page types can be added without an app rewrite.
*/

export type FieldType =
  | "text"
  | "long_text"
  | "url"
  | "phone"
  | "email"
  | "date"
  | "number"
  | "address"
  | "list";

export type RenderTarget = "page" | "schema";

export type ItemKind =
  | "person"
  | "service"
  | "price"
  | "award"
  | "social"
  | "faq"
  | "segment"
  | "generic";

export interface ListItemShape {
  key: string;
  label: string;
  type: "text" | "url" | "number" | "long_text";
  required?: boolean;
  /** Shown to the user as a hint and to the extractor as guidance. */
  hint?: string;
}

export interface TemplateField {
  id: string;
  section: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** What the crawler and extractor should look for. */
  lookFor: string;
  /** The plain-language question to ask when the field is missing. */
  question: string;
  /** Where the value renders. */
  rendersIn: RenderTarget[];
  /** For lists: the shape of one item. */
  itemShape?: ListItemShape[];
  itemKind?: ItemKind;
  /** For lists: item key used to de-duplicate across pages. */
  dedupeKey?: string;
  /** For lists: item keys that, when they disagree under one dedupe key, make a conflict. */
  conflictOn?: string[];
  /** Words from the banned list that are allowed in this field (credentials, modalities). */
  allowlist?: string[];
  /** Short example to show in the empty state. */
  example?: string;
  /** For `address` fields: the keys of the address object. */
  addressKeys?: string[];
  /** schema.org property this field maps to, if any. */
  schemaProperty?: string;
}

export interface TemplateSection {
  id: string;
  /** Title in the review screen. */
  title: string;
  /** H2 on the page, with [COMPANY] replaced. Empty for input-only sections. */
  heading?: string;
  description: string;
  order: number;
}

export interface KeyFactsRow {
  label: string;
  /** Field ids that feed this row, in priority order. */
  from: string[];
}

export interface TemplateSpec {
  id: string;
  version: number;
  name: string;
  description: string;
  sections: TemplateSection[];
  fields: TemplateField[];
  keyFactsRows: KeyFactsRow[];
  faq: { min: number; max: number; answerSentencesMin: number; answerSentencesMax: number };
  schema: {
    /** schema.org organization types the business_type field may take. */
    orgTypes: string[];
    /** Types that count as LocalBusiness subtypes and therefore take address, geo, hours. */
    localBusinessTypes: string[];
  };
}
