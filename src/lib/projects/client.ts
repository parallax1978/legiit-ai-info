/*
  Browser-side helpers for the projects API. No server-only imports: the new
  project form runs this in the browser.
*/

export type ProjectMode = "crawl" | "manual";

export interface CreateProjectResult {
  projectId: string;
  /** The first scan's run id. Null in manual mode, which starts no scan. */
  runId: string | null;
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
 * POST /api/projects with { siteUrl, mode }. Crawl mode, the default, resolves
 * with the new project and its first scan. Manual mode resolves with the
 * project alone: it starts in review with an empty fact sheet to fill in by
 * hand. Throws an Error carrying the server's message, which is the plan's
 * own message when the month's project allowance is used up (402).
 */
export async function createProject(siteUrl: string, mode: ProjectMode = "crawl"): Promise<CreateProjectResult> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ siteUrl, mode }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(await errorMessage(res));

  const body: unknown = await res.json();
  const { projectId, runId } = (body ?? {}) as { projectId?: unknown; runId?: unknown };
  if (typeof projectId !== "string") {
    throw new Error("The server answered without a project id.");
  }
  return { projectId, runId: typeof runId === "string" ? runId : null };
}
