import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJsonBody, requireApiUser, serverError } from "@/app/api/_lib/http";
import { redeemAccessCode } from "@/lib/billing/access-codes";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const BodySchema = z.object({
  code: z.string({ error: "Enter your code." }).trim().min(1, "Enter your code.").max(64, "That code is too long."),
});

/**
 * POST /api/access-codes/redeem { code }: checks the code exists, has not
 * expired, has uses left, and is new to this user; records the redemption,
 * takes one use, and sets the plan to sponsored. 200 { plan, message }.
 * 400 or 409 with a plain message otherwise.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const body = await readJsonBody(request);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Enter your code.");

  try {
    const result = await redeemAccessCode(createServiceClient(), user.id, parsed.data.code);
    if (!result.ok) return jsonError(result.status, result.message);
    return NextResponse.json({ plan: result.plan, message: result.message });
  } catch (e) {
    return serverError("POST /api/access-codes/redeem", e, "The code could not be redeemed. Try again in a moment.");
  }
}
