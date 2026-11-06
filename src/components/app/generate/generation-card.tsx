import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatCost, type GenerationView } from "@/lib/generate/view";
import { cn } from "@/lib/utils";
import { GenerateButton } from "./generate-button";
import { ShareControls } from "./share-controls";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** "Nov 6, 2026, 2:15 PM UTC", or the raw value when it does not parse. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFormat.format(d);
}

/*
  The finished page on the project screen: title, when it was written, what
  it cost, and the four actions. A server component; the share and generate
  buttons are client components.
*/
export function GenerationCard({
  generation,
  hasShareLink = false,
  staleFactSheet = false,
}: {
  generation: GenerationView;
  hasShareLink?: boolean;
  /** True when the fact sheet changed after this page was written. */
  staleFactSheet?: boolean;
}) {
  const pageHref = `/app/projects/${generation.projectId}/page`;
  const fill = generation.stillToFill.length;
  const lint = generation.lintIssues;

  return (
    <section className="rounded-card border border-line bg-white p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-good">Page ready</p>
          <h2 className="mt-1 break-words text-lg sm:text-xl">{generation.title ?? "Your About page"}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Written {formatWhen(generation.createdAt)}, version {generation.version}, cost {formatCost(generation.costUsd)}
          </p>
        </div>
      </div>

      {staleFactSheet || fill > 0 || lint > 0 ? (
        <ul className="mt-4 space-y-1.5 text-sm">
          {staleFactSheet ? (
            <li className="rounded-lg bg-warn-soft px-3 py-2 text-warn">
              The fact sheet changed after this page was written. Generate it again to bring the page up to date.
            </li>
          ) : null}
          {fill > 0 ? (
            <li className="rounded-lg bg-surface-alt px-3 py-2 text-ink-muted">
              {fill === 1 ? "One fact is" : `${fill} facts are`} still to fill. The page leaves a note where each belongs;
              the Still to fill tab lists the questions.
            </li>
          ) : null}
          {lint > 0 ? (
            <li className="rounded-lg bg-surface-alt px-3 py-2 text-ink-muted">
              {lint === 1 ? "One lint issue remains" : `${lint} lint issues remain`} in the copy. The Lint tab shows them.
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link href={pageHref} className={cn(buttonVariants({ variant: "primary", size: "sm" }))}>
          <FileText aria-hidden="true" />
          Open page
        </Link>
        <a
          href={`/api/generations/${encodeURIComponent(generation.id)}/zip`}
          download
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        >
          <Download aria-hidden="true" />
          Download zip
        </a>
        <ShareControls generationId={generation.id} initialHasLink={hasShareLink} />
        <GenerateButton label="Generate again" variant="secondary" />
      </div>
    </section>
  );
}
