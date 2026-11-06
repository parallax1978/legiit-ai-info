import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJsonBody, requireApiUser, serverError } from "@/app/api/_lib/http";
import { checkAllowance } from "@/lib/billing/caps";
import { normalizeSiteUrl, siteHost } from "@/lib/crawler/url";
import type { ProjectRow } from "@/lib/db/types";
import { emptyFactSheet } from "@/lib/facts/manual";
import { createRun } from "@/lib/runs/create";
import { insertFactSheet, insertProject, insertUsageEvent, updateProject, type Db } from "@/lib/runs/db";
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
  mode: z.enum(["crawl", "manual"], { error: "The mode must be crawl or manual." }).optional(),
});

/**
 * POST /api/projects { siteUrl, mode? }: creates the project. In crawl mode,
 * the default, its first scan starts at once: 201 { projectId, runId }. In
 * manual mode nothing is scanned: the project starts in review with a fact
 * sheet that has every field missing, for the owner to fill in by hand:
 * 201 { projectId, runId: null, factSheetId }. The site address is required
 * either way, because the page's link and the schema are built from it.
 * 402 with the plan's message when the month's project allowance is used up.
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
  const mode = parsed.data.mode ?? "crawl";

  try {
    const db = createServiceClient();
    // Before anything is written: a project over the cap must not exist, even without a scan.
    const allowance = await checkAllowance(db, { id: user.id, email: user.email ?? null }, "project");
    if (!allowance.ok) return jsonError(402, allowance.message);

    await ensureTemplate(db, ABOUT_V1);

    const project = await insertProject(db, {
      user_id: user.id,
      site_url: siteUrl,
      site_host: siteHost(siteUrl),
      template_id: ABOUT_V1.id,
      mode,
      status: mode === "manual" ? "review" : "crawling",
    });
    await insertUsageEvent(db, user.id, project.id, "project_created");

    if (mode === "manual") {
      const factSheetId = await createManualFactSheet(db, project);
      return NextResponse.json({ projectId: project.id, runId: null, factSheetId }, { status: 201 });
    }

    const run = await createRun(db, project, user.id);
    return NextResponse.json({ projectId: project.id, runId: run.id }, { status: 201 });
  } catch (e) {
    return serverError("POST /api/projects", e, "The project could not be created. Try again in a moment.");
  }
}

/** Version 1 of the project's fact sheet with every field missing, and the project pointed at it. */
async function createManualFactSheet(db: Db, project: ProjectRow): Promise<string> {
  const { data, stats } = emptyFactSheet(ABOUT_V1);
  const factSheetId = await insertFactSheet(db, {
    project_id: project.id,
    user_id: project.user_id,
    version: 1,
    source: "manual",
    crawl_run_id: null,
    template_id: ABOUT_V1.id,
    data,
    existing_schema: [],
    stats,
  });
  await updateProject(db, project.id, { latest_fact_sheet_id: factSheetId });
  return factSheetId;
}
