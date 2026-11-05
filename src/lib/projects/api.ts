/*
  Browser-side fetch helpers for the run and fact sheet routes. Client-safe:
  no server imports. Every request has a timeout, and callers may pass their
  own AbortSignal to stop a request on unmount.

  Routes (implemented in src/app/api):
    GET   /api/runs/[runId]            -> 200 { run: RunView } | 401 | 404
    POST  /api/runs/[runId]/step       -> 200 { run: RunView } | 409 { error: "locked", run: RunView } | 401 | 404
    PATCH /api/fact-sheets/[id]        -> 200 { field: FactField; stats: FactSheetStats } | 400 { error } | 401 | 404
    POST  /api/projects/[id]/runs      -> 201 { runId }
*/
import type { FactField, FactSheetStats, FactValue } from "@/lib/facts/types";
import type { RunView } from "./view";

/** Step routes may run for up to 60 s on the server; everything else is quick. */
const STEP_TIMEOUT_MS = 70_000;
const DEFAULT_TIMEOUT_MS = 20_000;

/** How long to wait when another caller holds the run lock, or after a network error. */
export const RETRY_DELAY_MS = 3_000;
/** Network errors tolerated in a row before the loop gives up. */
export const MAX_NETWORK_FAILURES = 5;

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export type FactSheetEdit =
  | { fieldId: string; value: FactValue; note?: string }
  | { fieldId: string; pickCandidate: number }
  | { fieldId: string; pickItemCandidate: { conflictKey: string; index: number } }
  | { fieldId: string; clear: true };

export interface FactSheetPatchResult {
  field: FactField;
  stats: FactSheetStats;
}

export type StepResult = { locked: false; run: RunView } | { locked: true; run: RunView | null };

export interface RequestOptions {
  signal?: AbortSignal | null;
  timeoutMs?: number;
}

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
  if (status === 404) return "That could not be found. It may belong to another account.";
  if (status === 400) return fromBody ?? "The server did not accept that change.";
  if (status === 409) return fromBody ?? "Another tab is working on this run.";
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

/** The message to show a person for any error thrown by these helpers. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError")) {
    return "The request took too long. Check your connection and try again.";
  }
  if (e instanceof TypeError) return "The server could not be reached. Check your connection and try again.";
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong.";
}

export function isNetworkError(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500;
  if (e instanceof DOMException) return e.name === "TimeoutError";
  return e instanceof TypeError;
}

export async function getRun(runId: string, opts: RequestOptions = {}): Promise<RunView> {
  const { status, body } = await request<{ run?: RunView }>(
    `/api/runs/${encodeURIComponent(runId)}`,
    { method: "GET" },
    opts,
  );
  if (status === 200 && body?.run) return body.run;
  throw new ApiError(status, messageForStatus(status, body), body);
}

/**
 * One bounded unit of work on the run. A 409 means another caller holds the
 * lock: wait RETRY_DELAY_MS and call again.
 */
export async function stepRun(runId: string, opts: RequestOptions = {}): Promise<StepResult> {
  const { status, body } = await request<{ run?: RunView; error?: string }>(
    `/api/runs/${encodeURIComponent(runId)}/step`,
    { method: "POST" },
    { timeoutMs: STEP_TIMEOUT_MS, ...opts },
  );
  if (status === 200 && body?.run) return { locked: false, run: body.run };
  if (status === 409) return { locked: true, run: body?.run ?? null };
  throw new ApiError(status, messageForStatus(status, body), body);
}

export async function patchFactSheet(
  factSheetId: string,
  edit: FactSheetEdit,
  opts: RequestOptions = {},
): Promise<FactSheetPatchResult> {
  const { status, body } = await request<{ field?: FactField; stats?: FactSheetStats; error?: string }>(
    `/api/fact-sheets/${encodeURIComponent(factSheetId)}`,
    { method: "PATCH", body: JSON.stringify(edit) },
    opts,
  );
  if (status === 200 && body?.field && body.stats) return { field: body.field, stats: body.stats };
  throw new ApiError(status, messageForStatus(status, body), body);
}

/** Starts a new run. reusePages keeps the stored pages and skips fetching. */
export async function startRun(
  projectId: string,
  options: { reusePages?: boolean } = {},
  opts: RequestOptions = {},
): Promise<{ runId: string }> {
  const { status, body } = await request<{ runId?: string; error?: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/runs`,
    { method: "POST", body: JSON.stringify({ reusePages: Boolean(options.reusePages) }) },
    opts,
  );
  if ((status === 201 || status === 200) && body?.runId) return { runId: body.runId };
  throw new ApiError(status, messageForStatus(status, body), body);
}
