import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { ExistingSchemaPanel } from "@/components/app/review/existing-schema-panel";
import { FactSheetReview } from "@/components/app/review/fact-sheet-review";
import { PagesPanel } from "@/components/app/review/pages-panel";
import { RerunControls, StartScanButton } from "@/components/app/run/rerun-controls";
import { RunProgress } from "@/components/app/run/run-progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth";
import type { CrawlRunRow, FactSheetRow, JsonLdBlock, PageStatusT, ProjectRow } from "@/lib/db/types";
import {
  hostOf,
  isRunFinished,
  runViewFromRow,
  schemaGroups,
  type PageDetail,
  type PageSummary,
  type SchemaGroup,
} from "@/lib/projects/view";
import { createClient } from "@/lib/supabase/server";
import { ABOUT_V1, getTemplate } from "@/templates/about-v1";
import type { TemplateSpec } from "@/templates/types";
import { ProjectHeader } from "./project-header";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Postgres rejects a malformed uuid with this code; treat it as not found. */
const INVALID_UUID = "22P02";

type PageRow = {
  id: string;
  url: string;
  title: string | null;
  status: PageStatusT;
  rank: number;
  reason: string | null;
  http_status: number | null;
  text_chars: number;
  error: string | null;
  jsonld: JsonLdBlock[];
};

async function loadProject(supabase: Supabase, id: string, userId: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (error.code === INVALID_UUID) return null;
    throw new Error(`Could not load the project: ${error.message}`);
  }
  return data;
}

/**
 * The run the project points at, else the newest one. When a newer run exists
 * than the one pointed at (the pointer lags a re-run), the newer one wins.
 */
async function loadRun(supabase: Supabase, project: ProjectRow): Promise<CrawlRunRow | null> {
  const [pointed, newest] = await Promise.all([
    project.latest_crawl_run_id
      ? supabase
          .from("crawl_runs")
          .select("*")
          .eq("id", project.latest_crawl_run_id)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
    supabase
      .from("crawl_runs")
      .select("*")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r) => r.data),
  ]);
  if (pointed && newest && newest.id !== pointed.id && newest.created_at > pointed.created_at) return newest;
  return pointed ?? newest ?? null;
}

/** The fact sheet the project points at, else the highest version. A higher version wins over a lagging pointer. */
async function loadFactSheet(supabase: Supabase, project: ProjectRow): Promise<FactSheetRow | null> {
  const [pointed, newest] = await Promise.all([
    project.latest_fact_sheet_id
      ? supabase
          .from("fact_sheets")
          .select("*")
          .eq("id", project.latest_fact_sheet_id)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
    supabase
      .from("fact_sheets")
      .select("*")
      .eq("project_id", project.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r) => r.data),
  ]);
  if (pointed && newest && newest.id !== pointed.id && newest.version > pointed.version) return newest;
  return pointed ?? newest ?? null;
}

async function loadPages(supabase: Supabase, runId: string): Promise<PageRow[]> {
  const { data } = await supabase
    .from("crawl_pages")
    .select("id, url, title, status, rank, reason, http_status, text_chars, error, jsonld")
    .eq("run_id", runId)
    .order("rank", { ascending: true });
  return (data ?? []) as PageRow[];
}

function templateFor(id: string): TemplateSpec {
  try {
    return getTemplate(id);
  } catch {
    return ABOUT_V1;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("business_name, site_host, site_url").eq("id", id).maybeSingle();
  const name = data ? data.business_name?.trim() || data.site_host || hostOf(data.site_url) : null;
  return { title: name || "Project", robots: { index: false, follow: false } };
}

export default async function ProjectPage({ params }: { params: Params }) {
  const { id } = await params;
  const user = await requireUser(`/app/projects/${id}`);
  const supabase = await createClient();

  const project = await loadProject(supabase, id, user.id);
  if (!project) notFound();

  const [run, factSheet] = await Promise.all([loadRun(supabase, project), loadFactSheet(supabase, project)]);
  const pages = run ? await loadPages(supabase, run.id) : [];
  const spec = templateFor(project.template_id);

  const runView = run ? runViewFromRow(run) : null;
  const running = runView !== null && !isRunFinished(runView);
  const failed = runView !== null && (runView.status === "failed" || runView.phase === "failed");
  const cancelled = runView?.status === "cancelled";
  const finishedWithoutSheet = runView !== null && runView.done && !factSheet;

  const pageDetails: PageDetail[] = pages.map((p) => ({
    id: p.id,
    url: p.url,
    title: p.title,
    status: p.status,
    rank: p.rank,
    reason: p.reason,
    httpStatus: p.http_status,
    textChars: p.text_chars ?? 0,
    error: p.error,
  }));
  const pageSummaries: PageSummary[] = pages.map((p) => ({ id: p.id, url: p.url, title: p.title }));
  const hasPages = pages.some((p) => p.status === "fetched" || p.status === "extracted");

  let groups: SchemaGroup[] = schemaGroups(pages);
  if (!groups.length && factSheet && Array.isArray(factSheet.existing_schema) && factSheet.existing_schema.length) {
    groups = [{ url: project.site_url, title: project.business_name, blocks: factSheet.existing_schema }];
  }

  return (
    <div className="space-y-6">
      <ProjectHeader project={project} run={runView} hasPages={hasPages} />

      {running && runView ? <RunProgress key={runView.id} initial={runView} /> : null}

      {failed && runView ? (
        <Alert className="border-bad/30 bg-bad-soft text-bad">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>The scan failed</AlertTitle>
          <AlertDescription className="text-bad/90">
            <p>{runView.error?.trim() || "Something stopped the scan before it finished."}</p>
            <div className="mt-3">
              <RerunControls projectId={project.id} canReuse={hasPages} />
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {cancelled ? (
        <Alert className="border-line bg-white text-ink">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>The scan was cancelled</AlertTitle>
          <AlertDescription>
            <p>Start it again when you are ready.</p>
            <div className="mt-3">
              <RerunControls projectId={project.id} canReuse={hasPages} />
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {finishedWithoutSheet ? (
        <Alert className="border-warn/30 bg-warn-soft text-warn">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>The scan finished but saved no fact sheet</AlertTitle>
          <AlertDescription className="text-warn/90">
            <p>Run it again. If it happens twice, email help@legiit.com with this page address.</p>
            <div className="mt-3">
              <RerunControls projectId={project.id} canReuse={hasPages} />
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {!runView && !factSheet ? (
        <div className="rounded-card border border-line bg-white p-8 shadow-card">
          <p className="eyebrow text-brand">Nothing scanned yet</p>
          <h2 className="mt-2 text-xl">Read the site and build the fact sheet</h2>
          <p className="mt-2 max-w-xl text-ink-muted">
            We read the pages that matter, pull out the facts with a quote and a source for each one, and show
            you what the site does not say.
          </p>
          <div className="mt-6">
            <StartScanButton projectId={project.id} />
          </div>
        </div>
      ) : null}

      {factSheet ? (
        <>
          <FactSheetReview key={factSheet.id} factSheet={factSheet} spec={spec} pages={pageSummaries} />
          <div className="space-y-4">
            <PagesPanel pages={pageDetails} />
            <ExistingSchemaPanel groups={groups} />
          </div>
        </>
      ) : null}
    </div>
  );
}
