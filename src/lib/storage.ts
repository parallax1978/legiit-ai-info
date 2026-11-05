import "server-only";

/*
  Raw crawled HTML in the private "crawl-html" bucket, one object per page at
  projectId/runId/pageId.html. Uploads are best effort: a failure is logged
  and the page keeps html_path null.
*/
import { createServiceClient, type ServiceClient } from "@/lib/supabase/service";

export const HTML_BUCKET = "crawl-html";

/** Storage calls go through fetch with no timeout of their own, so one is added here. */
const STORAGE_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function htmlPath(projectId: string, runId: string, pageId: string): string {
  return `${projectId}/${runId}/${pageId}.html`;
}

/** Uploads a page's HTML and returns its path, or null when the upload failed. Never throws. */
export async function putHtml(
  db: ServiceClient,
  input: { projectId: string; runId: string; pageId: string; html: string },
): Promise<string | null> {
  const path = htmlPath(input.projectId, input.runId, input.pageId);
  try {
    const { error } = await withTimeout(
      db.storage.from(HTML_BUCKET).upload(path, input.html, {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      }),
      STORAGE_TIMEOUT_MS,
      "html upload",
    );
    if (error) {
      console.error(`html upload failed for ${path}: ${error.message}`);
      return null;
    }
    return path;
  } catch (e) {
    console.error(`html upload failed for ${path}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Reads a page's stored HTML back, or null when it is missing or unreadable. Never throws. */
export async function getHtml(path: string, db: ServiceClient = createServiceClient()): Promise<string | null> {
  try {
    const { data, error } = await withTimeout(
      db.storage.from(HTML_BUCKET).download(path),
      STORAGE_TIMEOUT_MS,
      "html download",
    );
    if (error || !data) {
      if (error) console.error(`html download failed for ${path}: ${error.message}`);
      return null;
    }
    return await data.text();
  } catch (e) {
    console.error(`html download failed for ${path}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
