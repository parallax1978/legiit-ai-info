import {
  getGenerationPageHtml,
  getShareLinkByToken,
  isShareLinkLive,
  isShareToken,
  notFoundPage,
  pageResponseHeaders,
} from "@/lib/generate/share";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound(): Response {
  return new Response(notFoundPage(), { status: 404, headers: pageResponseHeaders() });
}

/**
 * GET /s/[token]: the shared page, public, no sign-in. The service client finds
 * the link by its token; a missing, expired, revoked, or malformed token is the
 * same 404. The page is marked noindex and is never cached by anything shared.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isShareToken(token)) return notFound();

  try {
    const db = createServiceClient();
    const link = await getShareLinkByToken(db, token);
    if (!link || !link.generation_id || !isShareLinkLive(link)) return notFound();

    const html = await getGenerationPageHtml(db, link.generation_id);
    if (!html) return notFound();

    return new Response(html, { status: 200, headers: pageResponseHeaders() });
  } catch (e) {
    console.error("GET /s/[token]:", e instanceof Error ? e.message : e);
    return new Response("Something went wrong. Try again in a moment.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex", "cache-control": "private, no-store" },
    });
  }
}
