/*
  Browser-side helpers for the projects API. No server-only imports: the new
  project form runs this in the browser.
*/

export interface CreateProjectResult {
  projectId: string;
  runId: string;
}

/** Turns what someone typed into a URL the API accepts, or null when it cannot be one. */
export function normalizeSiteInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function errorMessage(res: Response): Promise<string> {
  const fallback = `The server answered ${res.status}.`;
  try {
    const text = await res.text();
    if (!text) return fallback;
    try {
      const body: unknown = JSON.parse(text);
      if (body && typeof body === "object") {
        const { error, message } = body as { error?: unknown; message?: unknown };
        if (typeof error === "string" && error) return error;
        if (typeof message === "string" && message) return message;
      }
    } catch {
      // Not JSON: fall through to the raw text.
    }
    return text.length > 300 ? fallback : text;
  } catch {
    return fallback;
  }
}

/**
 * POST /api/projects with { siteUrl }. Resolves with the new project and its
 * first crawl run, or throws an Error carrying the server's message.
 */
// TODO: the route handler is built by another engineer; this is the agreed contract.
export async function createProject(siteUrl: string): Promise<CreateProjectResult> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ siteUrl }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(await errorMessage(res));

  const body: unknown = await res.json();
  const { projectId, runId } = (body ?? {}) as { projectId?: unknown; runId?: unknown };
  if (typeof projectId !== "string" || typeof runId !== "string") {
    throw new Error("The server answered without a project id.");
  }
  return { projectId, runId };
}
