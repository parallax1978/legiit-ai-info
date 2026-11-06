import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { jsonError, serverError } from "@/app/api/_lib/http";
import { applyStripeEvent, getStripe, isWebhookConfigured, webhookSecret } from "@/lib/billing/stripe";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * POST /api/billing/webhook: events from Stripe. The raw body is checked
 * against STRIPE_WEBHOOK_SECRET before anything in it is read; a bad or
 * missing signature is a 400. Applying an event is idempotent, so Stripe may
 * deliver it again. 503 when the webhook is not configured.
 */
export async function POST(request: Request) {
  if (!isWebhookConfigured()) return jsonError(503, "Billing webhooks are not set up.");

  const signature = request.headers.get("stripe-signature");
  const raw = await request.text();
  if (!signature) return jsonError(400, "Missing Stripe signature.");

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(raw, signature, webhookSecret());
  } catch (e) {
    console.warn("stripe webhook rejected:", e instanceof Error ? e.message : e);
    return jsonError(400, "The signature did not check out.");
  }

  try {
    const result = await applyStripeEvent(createServiceClient(), event);
    return NextResponse.json({ received: true, ...result });
  } catch (e) {
    // A 500 makes Stripe send the event again, which is right for a database hiccup.
    return serverError(`POST /api/billing/webhook (${event.type})`, e, "The event could not be applied.");
  }
}
