import { NextResponse } from "next/server";
import { jsonError, requireApiUser, serverError } from "@/app/api/_lib/http";
import { originFromHeaders } from "@/app/auth/redirects";
import { BILLING_NOT_CONFIGURED_MESSAGE, createPortalSession, isBillingConfigured } from "@/lib/billing/stripe";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * POST /api/billing/portal: a Stripe Billing Portal session for the signed-in
 * user's customer, returning to /account. 200 { url }. 400 when they have no
 * billing account yet. 503 when billing is not configured.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  if (!isBillingConfigured()) return jsonError(503, BILLING_NOT_CONFIGURED_MESSAGE);

  try {
    const result = await createPortalSession(createServiceClient(), { id: user.id }, originFromHeaders(request.headers));
    if (!result.ok) return jsonError(result.status, result.message);
    return NextResponse.json({ url: result.url });
  } catch (e) {
    return serverError("POST /api/billing/portal", e, "The billing portal could not be opened. Try again in a moment.");
  }
}
