import { NextResponse } from "next/server";
import { isUuid, jsonError, requireApiUser, serverError } from "@/app/api/_lib/http";
import { checkAllowance } from "@/lib/billing/caps";
import type { FactSheetRow, ProjectRow } from "@/lib/db/types";
import { getFactSheet, getProjectForUser, latestFactSheetForProject, type Db } from "@/lib/generate/db";
import { createGeneration } from "@/lib/generate/step";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/** The fact sheet the project points at, else its highest version. A higher version wins over a lagging pointer. */
async function currentFactSheet(db: Db, project: ProjectRow): Promise<FactSheetRow | null> {
  const [pointed, newest] = await Promise.all([
    project.latest_fact_sheet_id ? getFactSheet(db, project.latest_fact_sheet_id) : Promise.resolve(null),
    latestFactSheetForProject(db, project.id),
  ]);
  if (pointed && newest && newest.id !== pointed.id && newest.version > pointed.version) return newest;
  return pointed ?? newest ?? null;
}

/**
 * POST /api/projects/[id]/generations: starts writing the About page from
 * the project's current fact sheet. 201 { generationId }. 400 when there is
 * no fact sheet yet, 402 with the plan's message when the allowance is used up.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Project not found.");

  try {
    const db = createServiceClient();
    const project = await getProjectForUser(db, id, user.id);
    if (!project) return jsonError(404, "Project not found.");

    const sheet = await currentFactSheet(db, project);
    if (!sheet) return jsonError(400, "Build the fact sheet first: scan the site, or fill it in by hand.");

    const allowance = await checkAllowance(db, { id: user.id, email: user.email ?? null }, "generation", project.id);
    if (!allowance.ok) return jsonError(402, allowance.message);

    const generation = await createGeneration(db, project, user.id, sheet);
    return NextResponse.json({ generationId: generation.id }, { status: 201 });
  } catch (e) {
    return serverError("POST /api/projects/[id]/generations", e, "The page could not be started. Try again in a moment.");
  }
}
