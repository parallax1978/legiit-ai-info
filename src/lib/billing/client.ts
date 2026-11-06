/*
  Browser-side fetch helpers for the billing, access code, and admin code
  routes, in the shape of src/lib/projects/api.ts. Client-safe: no server
  imports. Every request has a timeout.

  Routes (implemented in src/app/api):
    POST /api/billing/checkout      -> 200 { url } | 400 { error } | 503 { error } | 401
    POST /api/billing/portal        -> 200 { url } | 400 { error } | 503 { error } | 401
    POST /api/access-codes/redeem   -> 200 { plan, message } | 400 | 409 { error } | 401
    POST /api/admin/access-codes    -> 201 { code } | 400 { error } | 403 | 401
*/
import { ApiError, errorMessage } from "@/lib/projects/api";

export { ApiError, errorMessage };

const TIMEOUT_MS = 20_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function messageForStatus(status: number, body: unknown): string {
  const fromBody = isRecord(body) && typeof body.error === "string" ? body.error : null;
  if (status === 401) return "Your session has ended. Sign in again.";
  if (status === 403) return fromBody ?? "You do not have access to that.";
  if (status === 503) return fromBody ?? "Billing is not set up yet.";
  if (status >= 500) return "The server hit an error. Try again in a moment.";
  return fromBody ?? `The server returned status ${status}.`;
}

async function post<T>(url: string, body: unknown = {}): Promise<{ status: number; body: T | null }> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let parsed: T | null = null;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      parsed = (await res.json()) as T;
    } catch {
      parsed = null;
    }
  }
  return { status: res.status, body: parsed };
}

/** Starts Stripe Checkout for the paid plan. Resolves with the page to send the browser to. */
export async function startCheckout(): Promise<{ url: string }> {
  const { status, body } = await post<{ url?: string; error?: string }>("/api/billing/checkout");
  if (status === 200 && body?.url) return { url: body.url };
  throw new ApiError(status, messageForStatus(status, body), body);
}

/** Opens the Stripe Billing Portal. Resolves with the page to send the browser to. */
export async function openBillingPortal(): Promise<{ url: string }> {
  const { status, body } = await post<{ url?: string; error?: string }>("/api/billing/portal");
  if (status === 200 && body?.url) return { url: body.url };
  throw new ApiError(status, messageForStatus(status, body), body);
}

export async function redeemAccessCode(code: string): Promise<{ plan: string; message: string }> {
  const { status, body } = await post<{ plan?: string; message?: string; error?: string }>("/api/access-codes/redeem", { code });
  if (status === 200 && body?.plan) return { plan: body.plan, message: body.message ?? "Your code is redeemed." };
  throw new ApiError(status, messageForStatus(status, body), body);
}

export interface AccessCodeSummary {
  id: string;
  code: string;
  label: string | null;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  created_at: string;
}

/** Admin only: makes a new access code. */
export async function createAccessCode(input: {
  label?: string;
  maxUses: number;
  expiresAt?: string | null;
}): Promise<AccessCodeSummary> {
  const { status, body } = await post<{ code?: AccessCodeSummary; error?: string }>("/api/admin/access-codes", input);
  if (status === 201 && body?.code) return body.code;
  throw new ApiError(status, messageForStatus(status, body), body);
}
