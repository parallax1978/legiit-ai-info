import { NextResponse } from "next/server";
import { isUuid, jsonError, requireApiUser, serverError } from "@/app/api/_lib/http";
import { getGenerationForUser } from "@/lib/generate/db";
import { stepGeneration } from "@/lib/generate/step";
import { createServiceClient } from "@/lib/supabase/service";

// One writer call per step, with a 170 s timeout (config.generate.timeoutMs),
// fits well inside this ceiling. A literal, because the build reads it
// statically (config.generate.maxDurationSeconds holds the same 300).
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/generations/[id]/step: one bounded unit of work on the generation.
 * 200 { generation }, or 409 { error: "locked", generation } when another caller holds the lock.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Generation not found.");

  try {
    const owned = await getGenerationForUser(createServiceClient(), id, user.id);
    if (!owned) return jsonError(404, "Generation not found.");

    const result = await stepGeneration(id, user.id);
    if (result.locked) return NextResponse.json({ error: "locked", generation: result.generation }, { status: 409 });
    return NextResponse.json({ generation: result.generation });
  } catch (e) {
    return serverError("POST /api/generations/[id]/step", e, "The page writer hit an error. It will retry on the next step.");
  }
}
