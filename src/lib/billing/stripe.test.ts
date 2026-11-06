import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fakeDb } from "./fake-db";
import { applyStripeEvent, isBillingConfigured, isWebhookConfigured, planForSignal, signalFromEvent } from "./stripe";

const user = "11111111-1111-4111-8111-111111111111";

function event(type: string, object: Record<string, unknown>, created = 1_800_000_000) {
  return { type, created, data: { object } };
}

const checkoutDone = event("checkout.session.completed", {
  mode: "subscription",
  payment_status: "paid",
  customer: "cus_1",
  subscription: "sub_1",
  client_reference_id: user,
});

describe("configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("needs the secret key and the price for checkout, and the webhook secret for events", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_PRICE_ID", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(isBillingConfigured()).toBe(false);
    expect(isWebhookConfigured()).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    expect(isBillingConfigured()).toBe(false);
    vi.stubEnv("STRIPE_PRICE_ID", "price_x");
    expect(isBillingConfigured()).toBe(true);
    expect(isWebhookConfigured()).toBe(false);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    expect(isWebhookConfigured()).toBe(true);
  });
});

describe("signalFromEvent", () => {
  it("reads a completed subscription checkout as paid, with the ids", () => {
    expect(signalFromEvent(checkoutDone)).toEqual({
      kind: "paid",
      userId: user,
      customerId: "cus_1",
      subscriptionId: "sub_1",
      at: 1_800_000_000,
    });
  });

  it("takes ids from expanded objects too", () => {
    const s = signalFromEvent(
      event("checkout.session.completed", { mode: "subscription", payment_status: "paid", customer: { id: "cus_2" }, subscription: { id: "sub_2" } }),
    );
    expect(s).toMatchObject({ kind: "paid", userId: null, customerId: "cus_2", subscriptionId: "sub_2" });
  });

  it("ignores a checkout that is not a paid subscription", () => {
    expect(signalFromEvent(event("checkout.session.completed", { mode: "payment", payment_status: "paid", customer: "cus_1" }))).toBeNull();
    expect(signalFromEvent(event("checkout.session.completed", { mode: "subscription", payment_status: "unpaid", customer: "cus_1" }))).toBeNull();
  });

  it("maps subscription statuses", () => {
    const sub = (status: string) =>
      signalFromEvent(event("customer.subscription.updated", { id: "sub_1", customer: "cus_1", status, metadata: { user_id: user } }));
    expect(sub("active")).toMatchObject({ kind: "paid", userId: user, customerId: "cus_1", subscriptionId: "sub_1" });
    expect(sub("trialing")).toMatchObject({ kind: "paid" });
    expect(sub("canceled")).toMatchObject({ kind: "ended" });
    expect(sub("unpaid")).toMatchObject({ kind: "ended" });
    expect(sub("paused")).toMatchObject({ kind: "ended" });
    expect(sub("incomplete_expired")).toMatchObject({ kind: "ended" });
    expect(sub("past_due")).toBeNull();
    expect(sub("incomplete")).toBeNull();
  });

  it("reads a deleted subscription as ended", () => {
    expect(signalFromEvent(event("customer.subscription.deleted", { id: "sub_1", customer: "cus_1", status: "canceled" }))).toMatchObject({
      kind: "ended",
      subscriptionId: "sub_1",
      customerId: "cus_1",
    });
  });

  it("ignores other events and odd payloads", () => {
    expect(signalFromEvent(event("invoice.paid", { customer: "cus_1" }))).toBeNull();
    expect(signalFromEvent(event("customer.subscription.updated", "not an object" as unknown as Record<string, unknown>))).toBeNull();
  });
});

describe("planForSignal", () => {
  it("is paid for a live subscription, else free, or sponsored with an access code", () => {
    expect(planForSignal({ kind: "paid" }, false)).toBe("paid");
    expect(planForSignal({ kind: "paid" }, true)).toBe("paid");
    expect(planForSignal({ kind: "ended" }, false)).toBe("free");
    expect(planForSignal({ kind: "ended" }, true)).toBe("sponsored");
  });
});

describe("applyStripeEvent", () => {
  const unique = { profiles: [["stripe_customer_id"]] };

  function world(profile: Record<string, unknown> = {}, redemptions: Record<string, unknown>[] = []) {
    return fakeDb(
      {
        profiles: [
          {
            id: user,
            email: "a@example.com",
            plan: "free",
            stripe_customer_id: null,
            stripe_subscription_id: null,
            plan_updated_at: null,
            ...profile,
          },
        ],
        access_code_redemptions: redemptions,
      },
      { unique },
    );
  }

  it("puts the user on the paid plan after checkout, with the Stripe ids and the event time", async () => {
    const w = world();
    expect(await applyStripeEvent(w.db, checkoutDone)).toEqual({ outcome: "applied", plan: "paid" });
    expect(w.tables.profiles[0]).toMatchObject({
      plan: "paid",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      plan_updated_at: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it("is idempotent: the same event again changes nothing", async () => {
    const w = world();
    await applyStripeEvent(w.db, checkoutDone);
    expect(await applyStripeEvent(w.db, checkoutDone)).toEqual({ outcome: "stale" });
    expect(w.tables.profiles[0].plan).toBe("paid");
  });

  it("skips an event older than the last change", async () => {
    const w = world();
    await applyStripeEvent(w.db, checkoutDone);
    const earlier = event("customer.subscription.deleted", { id: "sub_1", customer: "cus_1", status: "canceled" }, 1_799_999_000);
    expect(await applyStripeEvent(w.db, earlier)).toEqual({ outcome: "stale" });
    expect(w.tables.profiles[0].plan).toBe("paid");
  });

  it("ends the plan when the subscription ends, to free or to sponsored with an access code", async () => {
    const ended = event("customer.subscription.deleted", { id: "sub_1", customer: "cus_1", status: "canceled" }, 1_800_000_500);
    const w = world();
    await applyStripeEvent(w.db, checkoutDone);
    expect(await applyStripeEvent(w.db, ended)).toEqual({ outcome: "applied", plan: "free" });
    expect(w.tables.profiles[0]).toMatchObject({ plan: "free", stripe_subscription_id: null, stripe_customer_id: "cus_1" });

    const sponsored = world({}, [{ code_id: "c1", user_id: user }]);
    await applyStripeEvent(sponsored.db, checkoutDone);
    expect(await applyStripeEvent(sponsored.db, ended)).toEqual({ outcome: "applied", plan: "sponsored" });
    expect(sponsored.tables.profiles[0].plan).toBe("sponsored");
  });

  it("finds the profile by customer id when the event has no user id", async () => {
    const w = world({ plan: "paid", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
    const ended = event("customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "unpaid" }, 1_800_000_500);
    expect(await applyStripeEvent(w.db, ended)).toEqual({ outcome: "applied", plan: "free" });
  });

  it("never lets an old subscription end a newer one", async () => {
    const w = world({ plan: "paid", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_new" });
    const ended = event("customer.subscription.deleted", { id: "sub_old", customer: "cus_1", status: "canceled" }, 1_800_000_500);
    expect(await applyStripeEvent(w.db, ended)).toEqual({ outcome: "other_subscription" });
    expect(w.tables.profiles[0].plan).toBe("paid");
  });

  it("ignores events for unknown customers and events that say nothing about the plan", async () => {
    const w = world();
    expect(await applyStripeEvent(w.db, event("customer.subscription.deleted", { id: "sub_9", customer: "cus_9" }))).toEqual({ outcome: "no_profile" });
    expect(await applyStripeEvent(w.db, event("invoice.paid", { customer: "cus_1" }))).toEqual({ outcome: "ignored" });
    expect(w.tables.profiles[0].plan).toBe("free");
  });
});
