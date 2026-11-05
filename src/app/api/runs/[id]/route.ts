import { NextResponse } from "next/server";
import { isUuid, jsonError, requireApiUser, serverError } from "@/app/api/_lib/http";
import { runViewFromRow } from "@/lib/projects/view";
import { getRunForUser } from "@/lib/runs/db";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/** GET /api/runs/[id]: 200 { run: RunView }. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Run not found.");

  try {
    const run = await getRunForUser(createServiceClient(), id, user.id);
    if (!run) return jsonError(404, "Run not found.");
    return NextResponse.json({ run: runViewFromRow(run) });
  } catch (e) {
    return serverError("GET /api/runs/[id]", e);
  }
}
