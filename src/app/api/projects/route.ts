import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJsonBody, requireApiUser, serverError } from "@/app/api/_lib/http";
import { normalizeSiteUrl, siteHost } from "@/lib/crawler/url";
import { createRun } from "@/lib/runs/create";
import { insertProject, insertUsageEvent } from "@/lib/runs/db";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureTemplate } from "@/lib/templates/seed";
import { ABOUT_V1 } from "@/templates/about-v1";

export const runtime = "nodejs";

const BodySchema = z.object({
  siteUrl: z
    .string({ error: "Enter a website address." })
    .trim()
    .min(1, "Enter a website address.")
    .max(2048, "That address is too long."),
});

/**
 * POST /api/projects { siteUrl }: creates the project and its first crawl run.
 * 201 { projectId, runId }.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const { user } = auth;

  const body = await readJsonBody(request);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Enter a website address.");

  let siteUrl: string;
  try {
    siteUrl = normalizeSiteUrl(parsed.data.siteUrl);
  } catch (e) {
    return jsonError(400, e instanceof Error ? e.message : "That does not look like a website address.");
  }

  try {
    const db = createServiceClient();
    await ensureTemplate(db, ABOUT_V1);

    const project = await insertProject(db, {
      user_id: user.id,
      site_url: siteUrl,
      site_host: siteHost(siteUrl),
      template_id: ABOUT_V1.id,
      mode: "crawl",
      status: "crawling",
    });
    await insertUsageEvent(db, user.id, project.id, "project_created");

    const run = await createRun(db, project, user.id);
    return NextResponse.json({ projectId: project.id, runId: run.id }, { status: 201 });
  } catch (e) {
    return serverError("POST /api/projects", e, "The project could not be created. Try again in a moment.");
  }
}
