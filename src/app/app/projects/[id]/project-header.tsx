import { ArrowUpRight } from "lucide-react";
import { Pill } from "@/components/app/review/status-pill";
import { RerunControls, StartScanButton } from "@/components/app/run/rerun-controls";
import { StatusPill } from "@/components/app/shell/status-pill";
import type { ProjectRow } from "@/lib/db/types";
import { hostOf, hostPath, isRunFinished, platformLabel, type RunView } from "@/lib/projects/view";
import { GenerateButton } from "./generate-button";

/*
  Business name or host as the H1, the site URL, the platform when known,
  the project status, and the two actions.
*/
export function ProjectHeader({
  project,
  run,
  hasPages,
}: {
  project: ProjectRow;
  run: RunView | null;
  hasPages: boolean;
}) {
  const name = project.business_name?.trim() || project.site_host || hostOf(project.site_url);
  const platform = platformLabel(run && run.platform !== "unknown" ? run.platform : project.platform);
  const running = run !== null && !isRunFinished(run);

  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <p className="eyebrow text-brand">Project</p>
        <h1 className="mt-1 break-words text-2xl sm:text-3xl">{name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a
            href={project.site_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            {hostPath(project.site_url)}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
          {platform ? (
            <Pill tone="muted" className="h-6 px-2.5 font-semibold">
              {platform}
            </Pill>
          ) : null}
          <StatusPill status={project.status} />
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {run ? (
          <RerunControls projectId={project.id} canReuse={hasPages} disabled={running} />
        ) : (
          // A manual project has no scan yet: offer the first one, not a re-run.
          <StartScanButton projectId={project.id} />
        )}
        <GenerateButton />
      </div>
    </header>
  );
}
