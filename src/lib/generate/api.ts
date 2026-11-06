/*
  Browser-side fetch helpers for the generation routes, in the shape of
  src/lib/projects/api.ts. Client-safe: no server imports. Every request has
  a timeout, and callers may pass their own AbortSignal to stop a request on
  unmount.

  Routes (implemented in src/app/api):
    POST   /api/projects/[id]/generations  -> 201 { generationId } | 400 { error } | 402 { error } | 401 | 404
    GET    /api/generations/[id]           -> 200 { generation: GenerationView } | 401 | 404
    POST   /api/generations/[id]/step      -> 200 { generation } | 409 { error: "locked", generation } | 401 | 404
    POST   /api/generations/[id]/share     -> 200 { url } | 401 | 404
    DELETE /api/generations/[id]/share     -> 200 | 204 | 401 | 404
*/
import { ApiError, type RequestOptions } from "@/lib/projects/api";
import type { GenerationView } from "./view";

export { ApiError, MAX_NETWORK_FAILURES, RETRY_DELAY_MS, errorMessage, isNetworkError, type RequestOptions } from "@/lib/projects/api";

/** The step route may run for up to 300 s on the server (config.generate.maxDurationSeconds); everything else is quick. */
const STEP_TIMEOUT_MS = 310_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export type GenerationStepResult =
  | { locked: false; generation: GenerationView }
  | { locked: true; generation: GenerationView | null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One signal that aborts when any of the given signals does. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function messageForStatus(status: number, body: unknown): string {
  const fromBody = isRecord(body) && typeof body.error === "string" ? body.error : null;
  if (status === 401) return "Your session has ended. Sign in again.";
  if (status === 402) return fromBody ?? "Your plan does not include page generation. See the account page.";
  if (status === 404) return "That could not be found. It may belong to another account.";
  if (status === 400) return fromBody ?? "The server did not accept that request.";
  if (status === 409) return fromBody ?? "Another tab is working on this page.";
  if (status >= 500) return "The server hit an error. Try again in a moment.";
  return fromBody ?? `The server returned status ${status}.`;
}

async function request<T>(
  url: string,
  init: RequestInit,
  opts: RequestOptions = {},
): Promise<{ status: number; body: T | null }> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.signal ? anySignal([opts.signal, timeout]) : timeout;
  const res = await fetch(url, {
    ...init,
    signal,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  let body: T | null = null;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      body = (await res.json()) as T;
    } catch {
      body = null;
    }
  }
  return { status: res.status, body };
}

/** Starts a page for the project's current fact sheet. 402 carries the plan's message. */
export async function startGeneration(projectId: string, opts: RequestOptions = {}): Promise<{ generationId: string }> {
  const { status, body } = await request<{ generationId?: string; error?: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/generations`,
    { method: "POST", body: "{}" },
    opts,
  );
  if ((status === 201 || status === 200) && body?.generationId) return { generationId: body.generationId };
  throw new ApiError(status, messageForStatus(status, body), body);
}

export async function getGeneration(generationId: string, opts: RequestOptions = {}): Promise<GenerationView> {
  const { status, body } = await request<{ generation?: GenerationView }>(
    `/api/generations/${encodeURIComponent(generationId)}`,
    { method: "GET" },
    opts,
  );
  if (status === 200 && body?.generation) return body.generation;
  throw new ApiError(status, messageForStatus(status, body), body);
}

/**
 * One bounded unit of work on the generation. A 409 means another caller
 * holds the lock: wait RETRY_DELAY_MS and call again.
 */
export async function stepGeneration(generationId: string, opts: RequestOptions = {}): Promise<GenerationStepResult> {
  const { status, body } = await request<{ generation?: GenerationView; error?: string }>(
    `/api/generations/${encodeURIComponent(generationId)}/step`,
    { method: "POST" },
    { timeoutMs: STEP_TIMEOUT_MS, ...opts },
  );
  if (status === 200 && body?.generation) return { locked: false, generation: body.generation };
  if (status === 409) return { locked: true, generation: body?.generation ?? null };
  throw new ApiError(status, messageForStatus(status, body), body);
}

/** Makes the share link, or returns the one that exists. */
export async function createShareLink(generationId: string, opts: RequestOptions = {}): Promise<{ url: string }> {
  const { status, body } = await request<{ url?: string; error?: string }>(
    `/api/generations/${encodeURIComponent(generationId)}/share`,
    { method: "POST", body: "{}" },
    opts,
  );
  if ((status === 200 || status === 201) && body?.url) return { url: body.url };
  throw new ApiError(status, messageForStatus(status, body), body);
}

/** Revokes the share link; the public URL stops working. */
export async function revokeShareLink(generationId: string, opts: RequestOptions = {}): Promise<void> {
  const { status, body } = await request<{ error?: string }>(
    `/api/generations/${encodeURIComponent(generationId)}/share`,
    { method: "DELETE" },
    opts,
  );
  if (status === 200 || status === 204) return;
  throw new ApiError(status, messageForStatus(status, body), body);
}
