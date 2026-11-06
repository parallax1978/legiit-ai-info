import { isUuid, jsonError, requireApiUser, serverError } from "@/app/api/_lib/http";
import { getFactSheetData, getGenerationForUser, getProjectHost, zipFileName, zipFilesFor } from "@/lib/generate/share";
import { buildZip } from "@/lib/generate/zip";
import { hostOf } from "@/lib/projects/view";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A fresh buffer-backed copy, which is what a Response body is typed to take. */
function bodyOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

/**
 * GET /api/generations/[id]/zip: the download. about.html, about-wordpress.html,
 * schema.json, instructions.md, and fact-sheet.json in one zip, named after the
 * site's host. 404 when the generation is not the user's, 409 before it is done.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Generation not found.");

  try {
    const db = createServiceClient();
    const generation = await getGenerationForUser(db, id, user.id);
    if (!generation) return jsonError(404, "Generation not found.");
    if (generation.status !== "done" || !generation.page_html) return jsonError(409, "The page is not finished yet.");

    const [project, factSheet] = await Promise.all([
      getProjectHost(db, generation.project_id),
      generation.fact_sheet_id ? getFactSheetData(db, generation.fact_sheet_id) : Promise.resolve(null),
    ]);

    const host = project?.site_host?.trim() || (project ? hostOf(project.site_url) : "");
    const bytes = buildZip(zipFilesFor(generation, factSheet));

    return new Response(bodyOf(bytes), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${zipFileName(host)}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return serverError("GET /api/generations/[id]/zip", e);
  }
}
