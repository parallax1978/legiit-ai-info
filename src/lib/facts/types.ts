/*
  The fact sheet: one JSON document keyed by template field id.
*/

export type FactStatus = "found" | "missing" | "conflict" | "user_provided";

export type EvidenceSource = "page" | "jsonld" | "link" | "meta" | "image" | "user";

export interface Evidence {
  /** Verbatim text from the page, or the raw value for links and JSON-LD. */
  quote: string;
  /** The page the quote came from. */
  url: string;
  source: EvidenceSource;
}

/** A list item is a plain object of item-shape keys. */
export type ListItem = Record<string, string | undefined>;

export interface AddressValue {
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  addressCountry?: string;
  /** The address as one line, as the site wrote it. */
  text?: string;
}

export type FactValue = string | ListItem[] | AddressValue | null;

export interface Candidate {
  value: FactValue;
  evidence: Evidence[];
}

export interface ListItemConflict {
  /** The dedupe key value the conflict is about (a name, a plan name). */
  key: string;
  /** The item keys that disagree. */
  on: string[];
  candidates: Candidate[];
}

export interface FactField {
  value: FactValue;
  status: FactStatus;
  evidence: Evidence[];
  /** Present for scalar conflicts: every competing value with its evidence. */
  candidates?: Candidate[];
  /** Present for list fields: per-item conflicts (a name spelled two ways). */
  itemConflicts?: ListItemConflict[];
  /** The tool built this value (a URL from a handle) rather than found it. */
  derived?: boolean;
  /** Free-text note from the extractor or the user. */
  note?: string;
  /** Set when the user edited the field; keeps what the crawl found. */
  crawled?: { value: FactValue; status: FactStatus; evidence: Evidence[]; candidates?: Candidate[] };
  updatedAt?: string;
}

export interface FactSheetData {
  templateId: string;
  fields: Record<string, FactField>;
}

export interface FactSheetStats {
  found: number;
  missing: number;
  conflict: number;
  userProvided: number;
  requiredMissing: number;
  pagesUsed: number;
  findingsTotal: number;
  findingsDropped: number;
}

/** What the extractor produces for one page before merging. */
export interface Finding {
  fieldId: string;
  value: FactValue;
  quote: string;
  url: string;
  source: EvidenceSource;
  confidence: number;
  derived?: boolean;
  note?: string;
}

export const emptyField = (): FactField => ({ value: null, status: "missing", evidence: [] });
