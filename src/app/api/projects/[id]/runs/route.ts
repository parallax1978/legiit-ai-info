import { NextResponse } from "next/server";
import { z } from "zod";
import { isUuid, jsonError, readJsonBody, requireApiUser, serverError } from "@/app/api/_lib/http";
import { checkAllowance } from "@/lib/billing/caps";
import { createRun } from "@/lib/runs/create";
import { getProjectForUser } from "@/lib/runs/db";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const BodySchema = z.object({
  reusePages: z.boolean().optional(),
});

/**
 * POST /api/projects/[id]/runs { reusePages? }: starts a new crawl run. With
 * reusePages, the stored pages of the last run are copied and the run starts
 * at extraction. 201 { runId }. 402 with the plan's message when the
 * project's scan allowance is used up.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Project not found.");

  const body = await readJsonBody(request);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) return jsonError(400, "The request body is not valid.");

  try {
    const db = createServiceClient();
    const project = await getProjectForUser(db, id, user.id);
    if (!project) return jsonError(404, "Project not found.");

    const allowance = await checkAllowance(db, { id: user.id, email: user.email ?? null }, "crawl", project.id);
    if (!allowance.ok) return jsonError(402, allowance.message);

    const run = await createRun(db, project, user.id, { reusePages: parsed.data.reusePages === true });
    return NextResponse.json({ runId: run.id }, { status: 201 });
  } catch (e) {
    return serverError("POST /api/projects/[id]/runs", e, "The scan could not be started. Try again in a moment.");
  }
}
