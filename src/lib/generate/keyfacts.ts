/*
  The Key facts table, built from the fact sheet by code so nothing in it can
  be invented. See docs/build-spec.md; the schema+render builder replaces the stub.
*/
import type { FactSheetData } from "@/lib/facts/types";
import type { TemplateSpec } from "@/templates/types";
import type { KeyFactRow } from "./types";

export function keyFactsRows(spec: TemplateSpec, data: FactSheetData): KeyFactRow[] {
  void spec;
  void data;
  return [];
}
