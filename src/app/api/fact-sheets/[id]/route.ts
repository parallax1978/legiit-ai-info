import { NextResponse } from "next/server";
import { z } from "zod";
import { isUuid, jsonError, readJsonBody, requireApiUser, serverError } from "@/app/api/_lib/http";
import { applyUserEdit, recomputeStats, type UserEdit } from "@/lib/extract/merge";
import { emptyField, type FactField, type FactSheetData, type FactSheetStats, type FactValue } from "@/lib/facts/types";
import { getFactSheetForUser, updateFactSheet } from "@/lib/runs/db";
import { createServiceClient } from "@/lib/supabase/service";
import { TEMPLATES } from "@/templates/about-v1";
import type { TemplateField } from "@/templates/types";

export const runtime = "nodejs";

const MAX_TEXT = 20_000;

const AddressSchema = z
  .strictObject({
    streetAddress: z.string().max(500).optional(),
    addressLocality: z.string().max(200).optional(),
    addressRegion: z.string().max(200).optional(),
    postalCode: z.string().max(50).optional(),
    addressCountry: z.string().max(200).optional(),
    text: z.string().max(1000).optional(),
  })
  .refine((a) => Object.values(a).some((v) => typeof v === "string" && v.trim()), "Enter at least one address line.");

const ListSchema = z.array(z.record(z.string().max(100), z.string().max(MAX_TEXT))).max(200);

const ValueSchema = z.union([z.string().max(MAX_TEXT), ListSchema, AddressSchema]);

const fieldId = z.string().trim().min(1).max(100);

const EditSchema = z.union([
  z.strictObject({ fieldId, value: ValueSchema, note: z.string().max(2000).optional() }),
  z.strictObject({ fieldId, pickCandidate: z.number().int().min(0).max(1000) }),
  z.strictObject({
    fieldId,
    pickItemCandidate: z.strictObject({ conflictKey: z.string().max(1000), index: z.number().int().min(0).max(1000) }),
  }),
  z.strictObject({ fieldId, clear: z.literal(true) }),
]);

type Edit = z.infer<typeof EditSchema>;

/** A value edit has to fit the field's type: a list for list fields, an address object for address fields, a string otherwise. */
function valueMismatch(field: TemplateField, value: FactValue): string | null {
  if (field.type === "list") return Array.isArray(value) ? null : `${field.label} takes a list of items.`;
  if (field.type === "address") {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? null : `${field.label} takes an address.`;
  }
  return typeof value === "string" ? null : `${field.label} takes text.`;
}

function toUserEdit(edit: Edit): UserEdit {
  if ("clear" in edit) return { clear: true };
  if ("pickCandidate" in edit) return { pickCandidate: edit.pickCandidate };
  if ("pickItemCandidate" in edit) return { pickItemCandidate: edit.pickItemCandidate };
  return edit.note === undefined ? { value: edit.value } : { value: edit.value, note: edit.note };
}

function statsOf(raw: unknown): Partial<FactSheetStats> | undefined {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<FactSheetStats>) : undefined;
}

/**
 * PATCH /api/fact-sheets/[id]: one edit on one field. 200 { field, stats }.
 * Body: { fieldId, value, note? } | { fieldId, pickCandidate } |
 * { fieldId, pickItemCandidate: { conflictKey, index } } | { fieldId, clear: true }.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Fact sheet not found.");

  const body = await readJsonBody(request);
  const parsed = EditSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "That edit is not in a shape the server accepts.");
  const edit = parsed.data;

  try {
    const db = createServiceClient();
    const sheet = await getFactSheetForUser(db, id, user.id);
    if (!sheet) return jsonError(404, "Fact sheet not found.");

    const spec = TEMPLATES[sheet.template_id];
    if (!spec) return jsonError(400, "This fact sheet uses a template the app no longer has.");
    const field = spec.fields.find((f) => f.id === edit.fieldId);
    if (!field) return jsonError(400, "That field is not part of the template.");

    if ("value" in edit) {
      const mismatch = valueMismatch(field, edit.value);
      if (mismatch) return jsonError(400, mismatch);
    }

    const fields = sheet.data && typeof sheet.data === "object" && sheet.data.fields ? { ...sheet.data.fields } : {};
    const current = fields[field.id] ?? emptyField();

    let next: FactField;
    try {
      next = applyUserEdit(current, toUserEdit(edit));
    } catch (e) {
      return jsonError(400, e instanceof Error ? e.message : "That edit could not be applied.");
    }

    fields[field.id] = next;
    const data: FactSheetData = { templateId: spec.id, fields };
    const stats = recomputeStats(spec, data, statsOf(sheet.stats));
    await updateFactSheet(db, sheet.id, { data, stats });

    return NextResponse.json({ field: next, stats });
  } catch (e) {
    return serverError("PATCH /api/fact-sheets/[id]", e, "The change could not be saved. Try again in a moment.");
  }
}
