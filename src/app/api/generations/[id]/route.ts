import { NextResponse } from "next/server";
import { isUuid, jsonError, requireApiUser, serverError } from "@/app/api/_lib/http";
import { getGenerationForUser } from "@/lib/generate/db";
import { generationViewFromRow } from "@/lib/generate/view";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/** GET /api/generations/[id]: 200 { generation: GenerationView }. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Generation not found.");

  try {
    const generation = await getGenerationForUser(createServiceClient(), id, user.id);
    if (!generation) return jsonError(404, "Generation not found.");
    return NextResponse.json({ generation: generationViewFromRow(generation) });
  } catch (e) {
    return serverError("GET /api/generations/[id]", e);
  }
}
