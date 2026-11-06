import "server-only";

/*
  Stripe, only when configured. STRIPE_SECRET_KEY and STRIPE_PRICE_ID make
  Checkout and the Billing Portal work; STRIPE_WEBHOOK_SECRET makes the
  webhook accept events. Without them the routes answer 503 with a plain
  message and the account page says billing is not set up yet.

  The mapping from a Stripe event to a plan (signalFromEvent, planForSignal)
  is pure and tested. applyStripeEvent writes it to the profile and is
  idempotent: a replayed or late event is skipped by comparing the event's
  time with profiles.plan_updated_at.
*/
import Stripe from "stripe";
import { config, type PlanId } from "@/config";
import { DbError, type Db } from "@/lib/runs/db";
import { hasRedeemedAccessCode } from "./access-codes";

export const BILLING_NOT_CONFIGURED_MESSAGE = `Billing is not set up yet. Email ${config.site.supportEmail} to change your plan.`;

/** The API version the installed SDK's types describe. Pinned so the wire shapes match the types. */
const API_VERSION = "2026-10-28.endive";

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

export function isWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

export function priceId(): string {
  const id = process.env.STRIPE_PRICE_ID;
  if (!id) throw new Error("STRIPE_PRICE_ID is not set");
  return id;
}

export function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return secret;
}

let cached: { key: string; client: Stripe } | null = null;

/** The Stripe client, made on first use from STRIPE_SECRET_KEY. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!cached || cached.key !== key) {
    cached = {
      key,
      client: new Stripe(key, { apiVersion: API_VERSION, typescript: true, maxNetworkRetries: 2, timeout: 20_000 }),
    };
  }
  return cached.client;
}

// ---------------------------------------------------------------------------
// Checkout and the portal
// ---------------------------------------------------------------------------

export type SessionResult = { ok: true; url: string } | { ok: false; status: 400 | 500; message: string };

interface BillingProfile {
  id: string;
  email: string;
  plan: PlanId;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_updated_at: string | null;
}

const PROFILE_COLUMNS = "id, email, plan, stripe_customer_id, stripe_subscription_id, plan_updated_at";

async function profileById(db: Db, userId: string): Promise<BillingProfile | null> {
  const res = await db.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (res.error) throw new DbError("read profile", res.error);
  return res.data;
}

async function profileByCustomer(db: Db, customerId: string): Promise<BillingProfile | null> {
  const res = await db.from("profiles").select(PROFILE_COLUMNS).eq("stripe_customer_id", customerId).maybeSingle();
  if (res.error) throw new DbError("read profile", res.error);
  return res.data;
}

/** The profile's Stripe customer, made from the email on first use and stored on the profile. */
async function customerIdFor(db: Db, profile: BillingProfile, email: string | null): Promise<string> {
  if (profile.stripe_customer_id) return profile.stripe_customer_id;
  const customer = await getStripe().customers.create(
    { email: email ?? profile.email, metadata: { user_id: profile.id } },
    { idempotencyKey: `customer-${profile.id}` },
  );
  const res = await db.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", profile.id);
  if (res.error) throw new DbError("save customer id", res.error);
  return customer.id;
}

/**
 * A Checkout Session for the plan: mode subscription, the configured price,
 * the profile's customer, success and cancel URLs on /account, and the user
 * id as client_reference_id so the webhook finds the profile.
 */
export async function createCheckoutSession(
  db: Db,
  user: { id: string; email: string | null },
  origin: string,
): Promise<SessionResult> {
  const profile = await profileById(db, user.id);
  if (!profile) return { ok: false, status: 500, message: "Your profile could not be found. Sign out and in again." };
  if (profile.plan === "paid") {
    return { ok: false, status: 400, message: "You already have the paid plan. Use Manage billing to change it." };
  }

  const customer = await customerIdFor(db, profile, user.email);
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId(), quantity: 1 }],
    customer,
    client_reference_id: user.id,
    success_url: `${origin}/account?checkout=success`,
    cancel_url: `${origin}/account?checkout=cancelled`,
    allow_promotion_codes: true,
    subscription_data: { metadata: { user_id: user.id } },
  });
  if (!session.url) return { ok: false, status: 500, message: "Stripe did not return a checkout link. Try again in a moment." };
  return { ok: true, url: session.url };
}

/** A Billing Portal session for the profile's customer, returning to /account. */
export async function createPortalSession(db: Db, user: { id: string }, origin: string): Promise<SessionResult> {
  const profile = await profileById(db, user.id);
  if (!profile?.stripe_customer_id) {
    return { ok: false, status: 400, message: "There is no billing account for you yet. Upgrade first." };
  }
  const session = await getStripe().billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${origin}/account`,
  });
  return { ok: true, url: session.url };
}

// ---------------------------------------------------------------------------
// Webhook events to plans
// ---------------------------------------------------------------------------

/** The parts of a Stripe event the plan mapping reads. Stripe.Event fits; tests build them by hand. */
export interface EventLike {
  type: string;
  /** Unix seconds. */
  created: number;
  data: { object: unknown };
}

export interface PlanSignal {
  /** paid: a subscription is live. ended: it is gone, cancelled, or unpaid. */
  kind: "paid" | "ended";
  /** The checkout session's client_reference_id or the subscription's metadata.user_id. */
  userId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  /** Unix seconds, from the event. */
  at: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A Stripe id, from a string or an expanded object. */
function idOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (isRecord(v) && typeof v.id === "string") return v.id;
  return null;
}

function metadataUserId(o: Record<string, unknown>): string | null {
  return isRecord(o.metadata) && typeof o.metadata.user_id === "string" ? o.metadata.user_id : null;
}

const LIVE_STATUSES = new Set(["active", "trialing"]);
const ENDED_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired", "paused"]);

/**
 * What an event says about the plan, or null when it says nothing: another
 * event type, a checkout that is not a subscription, or a status in between
 * such as past_due, which Stripe retries before it ends the subscription.
 */
export function signalFromEvent(event: EventLike): PlanSignal | null {
  const o = event.data.object;
  if (!isRecord(o)) return null;
  const customerId = idOf(o.customer);
  const at = event.created;

  if (event.type === "checkout.session.completed") {
    if (o.mode !== "subscription" || o.payment_status === "unpaid") return null;
    const userId = typeof o.client_reference_id === "string" ? o.client_reference_id : null;
    return { kind: "paid", userId, customerId, subscriptionId: idOf(o.subscription), at };
  }
  if (event.type === "customer.subscription.deleted") {
    return { kind: "ended", userId: metadataUserId(o), customerId, subscriptionId: idOf(o.id), at };
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    const status = typeof o.status === "string" ? o.status : "";
    const base = { userId: metadataUserId(o), customerId, subscriptionId: idOf(o.id), at };
    if (LIVE_STATUSES.has(status)) return { kind: "paid", ...base };
    if (ENDED_STATUSES.has(status)) return { kind: "ended", ...base };
    return null;
  }
  return null;
}

/** The plan after a signal: paid, else free, or sponsored when the user has redeemed an access code. */
export function planForSignal(signal: Pick<PlanSignal, "kind">, hasAccessCode: boolean): PlanId {
  if (signal.kind === "paid") return "paid";
  return hasAccessCode ? "sponsored" : "free";
}

export type WebhookOutcome = "ignored" | "no_profile" | "stale" | "other_subscription" | "customer_taken" | "applied";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function profileFor(db: Db, signal: PlanSignal): Promise<BillingProfile | null> {
  if (signal.userId && UUID_RE.test(signal.userId)) {
    const byId = await profileById(db, signal.userId);
    if (byId) return byId;
  }
  return signal.customerId ? profileByCustomer(db, signal.customerId) : null;
}

/**
 * Applies a verified event to the profile it concerns. Safe to call again
 * with the same event: a change applied at or after the event's time wins,
 * and an old subscription ending never ends a newer one.
 */
export async function applyStripeEvent(db: Db, event: EventLike): Promise<{ outcome: WebhookOutcome; plan?: PlanId }> {
  const signal = signalFromEvent(event);
  if (!signal) return { outcome: "ignored" };
  const profile = await profileFor(db, signal);
  if (!profile) return { outcome: "no_profile" };

  const at = new Date(signal.at * 1000);
  if (profile.plan_updated_at && Date.parse(profile.plan_updated_at) >= at.getTime()) return { outcome: "stale" };
  if (
    signal.kind === "ended" &&
    profile.stripe_subscription_id &&
    signal.subscriptionId &&
    profile.stripe_subscription_id !== signal.subscriptionId
  ) {
    return { outcome: "other_subscription" };
  }

  const hasAccessCode = signal.kind === "ended" ? await hasRedeemedAccessCode(db, profile.id) : false;
  const plan = planForSignal(signal, hasAccessCode);
  const patch =
    signal.kind === "paid"
      ? {
          plan,
          stripe_customer_id: signal.customerId ?? profile.stripe_customer_id,
          stripe_subscription_id: signal.subscriptionId ?? profile.stripe_subscription_id,
          plan_updated_at: at.toISOString(),
        }
      : { plan, stripe_subscription_id: null, plan_updated_at: at.toISOString() };
  const res = await db.from("profiles").update(patch).eq("id", profile.id);
  if (res.error) {
    if (res.error.code === "23505") return { outcome: "customer_taken" };
    throw new DbError("update plan", res.error);
  }
  return { outcome: "applied", plan };
}
