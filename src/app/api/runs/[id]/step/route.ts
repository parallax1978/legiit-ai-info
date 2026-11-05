import { NextResponse } from "next/server";
import { isUuid, jsonError, requireApiUser, serverError } from "@/app/api/_lib/http";
import { getRunForUser } from "@/lib/runs/db";
import { stepRun } from "@/lib/runs/step";
import { createServiceClient } from "@/lib/supabase/service";

// cheerio and the fetch streams need Node; the step stops itself at
// config.crawl.stepBudgetMs, well inside this ceiling. A literal, because the
// build reads it statically (config.stepMaxDurationSeconds holds the same 60).
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST /api/runs/[id]/step: one bounded slice of work on the run.
 * 200 { run }, or 409 { error: "locked", run } when another caller holds the lock.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Run not found.");

  try {
    const owned = await getRunForUser(createServiceClient(), id, user.id);
    if (!owned) return jsonError(404, "Run not found.");

    const result = await stepRun(id, user.id);
    if (result.locked) return NextResponse.json({ error: "locked", run: result.run }, { status: 409 });
    return NextResponse.json({ run: result.run });
  } catch (e) {
    return serverError("POST /api/runs/[id]/step", e, "The scan hit an error. It will retry on the next step.");
  }
}
