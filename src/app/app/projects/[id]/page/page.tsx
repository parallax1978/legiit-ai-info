import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, TriangleAlert } from "lucide-react";
import { GenerateButton } from "@/components/app/generate/generate-button";
import { GenerateProvider, type GenerateState } from "@/components/app/generate/generate-context";
import { formatWhen } from "@/components/app/generate/generation-card";
import { GenerationFailed } from "@/components/app/generate/generation-failed";
import { GenerationProgress } from "@/components/app/generate/generation-progress";
import { PageTabs } from "@/components/app/generate/page-tabs";
import { ShareControls } from "@/components/app/generate/share-controls";
import { StatusPill } from "@/components/app/shell/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import type { FactSheetRow, GenerationRow, ProjectRow } from "@/lib/db/types";
import {
  activeShareLinkForGeneration,
  getFactSheet,
  getGeneration,
  getProjectForUser,
  latestFactSheetForProject,
  latestGenerationForProject,
  type Db,
} from "@/lib/generate/db";
import {
  fieldQuestions,
  formatCost,
  generationViewFromRow,
  isGenerationFinished,
  lintIssueViews,
  lintReportOf,
  missingRequiredFields,
  reviewHref,
  stillToFillOf,
} from "@/lib/generate/view";
import { hostOf } from "@/lib/projects/view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ABOUT_V1, getTemplate } from "@/templates/about-v1";
import type { TemplateSpec } from "@/templates/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The generation the project points at, else the newest. A newer one wins over a lagging pointer. */
async function loadGeneration(db: Db, project: ProjectRow): Promise<GenerationRow | null> {
  const [pointed, newest] = await Promise.all([
    project.latest_generation_id ? getGeneration(db, project.latest_generation_id) : Promise.resolve(null),
    latestGenerationForProject(db, project.id),
  ]);
  if (pointed && newest && newest.id !== pointed.id && newest.created_at > pointed.created_at) return newest;
  return pointed ?? newest ?? null;
}

/** The fact sheet the project points at, else the highest version. */
async function loadFactSheet(db: Db, project: ProjectRow): Promise<FactSheetRow | null> {
  const [pointed, newest] = await Promise.all([
    project.latest_fact_sheet_id ? getFactSheet(db, project.latest_fact_sheet_id) : Promise.resolve(null),
    latestFactSheetForProject(db, project.id),
  ]);
  if (pointed && newest && newest.id !== pointed.id && newest.version > pointed.version) return newest;
  return pointed ?? newest ?? null;
}

function templateFor(id: string): TemplateSpec {
  try {
    return getTemplate(id);
  } catch {
    return ABOUT_V1;
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("business_name, site_host, site_url").eq("id", id).maybeSingle();
  const name = data ? data.business_name?.trim() || data.site_host || hostOf(data.site_url) : null;
  return { title: name ? `${name}: About page` : "About page", robots: { index: false, follow: false } };
}

/*
  The page screen: the generation's outputs in tabs once it is done, its
  progress while it is being written, and the way to try again when it
  failed. The session client reads everything; RLS keeps it to the owner.
*/
export default async function GenerationPage({ params }: { params: Params }) {
  const { id } = await params;
  const user = await requireUser(`/app/projects/${id}/page`);
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();

  const project = await getProjectForUser(supabase, id, user.id);
  if (!project) notFound();

  const [generation, factSheet] = await Promise.all([loadGeneration(supabase, project), loadFactSheet(supabase, project)]);
  const spec = templateFor(project.template_id);
  const name = project.business_name?.trim() || project.site_host || hostOf(project.site_url);

  const view = generation ? generationViewFromRow(generation) : null;
  const finished = view !== null && isGenerationFinished(view);
  const done = view?.status === "done" && generation !== null;
  const missing = missingRequiredFields(spec, factSheet?.data, project.business_name);
  const state: GenerateState = {
    projectId: project.id,
    hasFactSheet: factSheet !== null,
    busy: view !== null && !finished,
    missing,
    reviewHref: reviewHref(project.id, missing[0] ? { fieldId: missing[0].id } : undefined),
  };

  const shareLink = done ? await activeShareLinkForGeneration(supabase, generation.id) : null;
  const report = generation ? lintReportOf(generation.lint_report) : null;
  const stillToFill = generation
    ? fieldQuestions(spec, stillToFillOf(generation.still_to_fill), project.business_name).map((f) => ({
        ...f,
        href: reviewHref(project.id, { fieldId: f.id }),
      }))
    : [];

  return (
    <GenerateProvider value={state}>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <Link
              href={`/app/projects/${project.id}`}
              className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {name}
            </Link>
            <p className="eyebrow mt-3 text-brand">About page</p>
            <h1 className="mt-1 break-words text-2xl sm:text-3xl">{view?.title ?? `The About page for ${name}`}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <StatusPill status={project.status} />
              {done ? (
                <span>
                  Version {view.version}, written {formatWhen(view.createdAt)}, cost {formatCost(view.costUsd)}
                </span>
              ) : null}
            </div>
          </div>
          {done ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <a
                href={`/api/generations/${encodeURIComponent(generation.id)}/zip`}
                download
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                <Download aria-hidden="true" />
                Download zip
              </a>
              <ShareControls generationId={generation.id} initialHasLink={shareLink !== null} />
              <GenerateButton label="Generate again" />
            </div>
          ) : null}
        </header>

        {!view ? (
          <div className="rounded-card border border-line bg-white p-8 shadow-card">
            <p className="eyebrow text-brand">No page yet</p>
            <h2 className="mt-2 text-xl">Write the About page from the fact sheet</h2>
            <p className="mt-2 max-w-xl text-ink-muted">
              {factSheet
                ? "The writer uses only the facts on the fact sheet, with a quote behind each one, and leaves a note wherever a required fact is still missing."
                : "Scan the site, or fill in the fact sheet by hand, and the page can be written from it."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <GenerateButton size="md" />
              {!factSheet ? (
                <Link href={`/app/projects/${project.id}`} className={cn(buttonVariants({ variant: "secondary", size: "md" }))}>
                  Back to the project
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        {view && !finished ? <GenerationProgress key={view.id} initial={view} /> : null}

        {view?.status === "failed" ? <GenerationFailed generation={view} /> : null}

        {done && !view.hasPage ? (
          <Alert className="border-warn/30 bg-warn-soft text-warn">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>The page finished without its HTML</AlertTitle>
            <AlertDescription className="text-warn/90">
              <p>Generate it again. If it happens twice, email help@legiit.com with this page address.</p>
              <div className="mt-3">
                <GenerateButton label="Generate again" />
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {done && view.hasPage ? (
          <PageTabs
            generationId={generation.id}
            pageHtml={generation.page_html ?? ""}
            wordpressHtml={generation.wordpress_html ?? ""}
            schemaJson={prettyJson(generation.schema)}
            instructionsMd={generation.instructions_md ?? ""}
            stillToFill={stillToFill}
            lint={{ passed: report?.passed ?? null, attempts: report?.attempts ?? 0, issues: lintIssueViews(report) }}
          />
        ) : null}
      </div>
    </GenerateProvider>
  );
}
