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
  /**
   * Told to the extractor in place of the hint when the editor's example is
   * the wrong guide, for a key the extractor should write as the page does.
   */
  extractHint?: string;
  /**
   * "summary": the model writes this key in its own words (a policy's name, a
   * differentiator's headline, a customer segment), so its words need not all
   * be on the page. Its numbers must still be in the quote.
   */
  wording?: "summary";
  /**
   * How the quote check reads this key when a plain text check is the wrong test:
   * - "codes": short codes such as credentials ("CPA, MBA"); every code must be on the page.
   * - "quoted": its words must be in the quote, as its numbers are ("Free" is on most pages, so a price is read from its quote).
   * - "heading": a heading of one or two words the model writes for the rest of the item (a policy's
   *   "Cancellation"); its words need not be on the page, but the quote must be about the item.
   * - "choice": a value the model picks rather than reads (a platform name); only its numbers are checked.
   * - "days": days of the week, compared as a set ("Mon - Fri" is "Monday to Friday").
   * - "time": a clock time, compared in minutes ("17:00" is "5:00 PM").
   */
  check?: "codes" | "quoted" | "heading" | "choice" | "days" | "time";
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
  /**
   * For lists: an item is kept only when its quote or one of its values says
   * one of these words (founders: founder, owner). A person the model files
   * as a founder with nothing that calls them one is dropped.
   */
  evidenceMustMention?: string[];
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
