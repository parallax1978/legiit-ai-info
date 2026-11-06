import { NextResponse } from "next/server";
import { isUuid, jsonError, requireApiUser, serverError } from "@/app/api/_lib/http";
import { config } from "@/config";
import {
  deleteShareLinksForGeneration,
  getGenerationForUser,
  insertShareLink,
  isShareLinkLive,
  listShareLinksForGeneration,
  newShareToken,
  shareExpiresAt,
  shareUrl,
} from "@/lib/generate/share";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/generations/[id]/share: the public link for the page, served by
 * /s/[token] for 30 days. One link per generation: the live one is returned
 * (200), else a new one is made (201). { url }. 404 when the generation is not
 * the user's, 409 before the page exists.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Generation not found.");

  try {
    const db = createServiceClient();
    const generation = await getGenerationForUser(db, id, user.id);
    if (!generation) return jsonError(404, "Generation not found.");
    if (!generation.page_html) return jsonError(409, "The page is not finished yet, so there is nothing to share.");

    const now = new Date();
    const links = await listShareLinksForGeneration(db, generation.id);
    const live = links.find((link) => isShareLinkLive(link, now));
    if (live) return NextResponse.json({ url: shareUrl(config.site.url, live.token) });

    // Only expired links are left; clear them so the generation keeps one row.
    if (links.length) await deleteShareLinksForGeneration(db, generation.id);
    const link = await insertShareLink(db, {
      token: newShareToken(),
      project_id: generation.project_id,
      generation_id: generation.id,
      user_id: user.id,
      expires_at: shareExpiresAt(now),
    });
    return NextResponse.json({ url: shareUrl(config.site.url, link.token) }, { status: 201 });
  } catch (e) {
    return serverError("POST /api/generations/[id]/share", e);
  }
}

/** DELETE /api/generations/[id]/share: revokes every link of the generation; the public URL stops working. 200 { ok: true }. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Generation not found.");

  try {
    const db = createServiceClient();
    const generation = await getGenerationForUser(db, id, user.id);
    if (!generation) return jsonError(404, "Generation not found.");
    await deleteShareLinksForGeneration(db, generation.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError("DELETE /api/generations/[id]/share", e);
  }
}
