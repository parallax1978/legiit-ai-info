import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJsonBody, requireApiUser, serverError } from "@/app/api/_lib/http";
import { isAdminEmail } from "@/lib/auth";
import { createAccessCode, listAccessCodes } from "@/lib/billing/access-codes";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const MAX_USES = 100_000;

const BodySchema = z.object({
  label: z.string().trim().max(200, "Keep the label under 200 characters.").optional(),
  maxUses: z.number().int().min(1, "Max uses must be 1 or more.").max(MAX_USES, "That is too many uses.").optional(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

async function requireAdminApi() {
  const auth = await requireApiUser();
  if (auth.response) return auth;
  if (!isAdminEmail(auth.user.email)) return { response: jsonError(403, "Admins only.") };
  return auth;
}

/** GET /api/admin/access-codes: every code, newest first. 200 { codes }. */
export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  try {
    const codes = await listAccessCodes(createServiceClient());
    return NextResponse.json({ codes });
  } catch (e) {
    return serverError("GET /api/admin/access-codes", e);
  }
}

/**
 * POST /api/admin/access-codes { label?, maxUses?, expiresAt? }: makes a code
 * of 12 upper-case letters and digits without 0, O, 1, or I. 201 { code }.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const { user } = auth;

  const body = await readJsonBody(request);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "The request body is not valid.");
  const { label, maxUses, expiresAt } = parsed.data;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) return jsonError(400, "The expiry date has to be in the future.");

  try {
    const code = await createAccessCode(createServiceClient(), {
      label: label || null,
      maxUses: maxUses ?? 1,
      expiresAt: expiresAt ?? null,
      createdBy: user.id,
    });
    return NextResponse.json({ code }, { status: 201 });
  } catch (e) {
    return serverError("POST /api/admin/access-codes", e, "The code could not be made. Try again in a moment.");
  }
}
