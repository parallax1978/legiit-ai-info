import { NextResponse } from "next/server";
import { jsonError, requireApiUser, serverError } from "@/app/api/_lib/http";
import { originFromHeaders } from "@/app/auth/redirects";
import { BILLING_NOT_CONFIGURED_MESSAGE, createCheckoutSession, isBillingConfigured } from "@/lib/billing/stripe";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * POST /api/billing/checkout: a Stripe Checkout Session for the paid plan,
 * for the signed-in user. 200 { url }. 400 when they already have it. 503
 * with a plain message when billing is not configured.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  if (!isBillingConfigured()) return jsonError(503, BILLING_NOT_CONFIGURED_MESSAGE);

  try {
    const result = await createCheckoutSession(
      createServiceClient(),
      { id: user.id, email: user.email ?? null },
      originFromHeaders(request.headers),
    );
    if (!result.ok) return jsonError(result.status, result.message);
    return NextResponse.json({ url: result.url });
  } catch (e) {
    return serverError("POST /api/billing/checkout", e, "Checkout could not be started. Try again in a moment.");
  }
}
