import { isUuid, jsonError, requireApiUser, serverError } from "@/app/api/_lib/http";
import { getGenerationForUser, pageResponseHeaders } from "@/lib/generate/share";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/generations/[id]/html: the page as text/html, for "open in a tab".
 * Marked noindex and never cached. 404 when the generation is not the user's,
 * 409 before the page exists.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Generation not found.");

  try {
    const generation = await getGenerationForUser(createServiceClient(), id, user.id);
    if (!generation) return jsonError(404, "Generation not found.");
    if (!generation.page_html) return jsonError(409, "The page is not finished yet.");
    return new Response(generation.page_html, { status: 200, headers: pageResponseHeaders() });
  } catch (e) {
    return serverError("GET /api/generations/[id]/html", e);
  }
}
