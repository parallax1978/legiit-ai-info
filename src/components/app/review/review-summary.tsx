import { CircleCheck } from "lucide-react";
import type { FactSheetStats } from "@/lib/facts/types";
import { Progress } from "@/components/ui/progress";
import { completion, formatNumber, type StatusCounts } from "@/lib/projects/view";

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "N found, N contradicted, N missing", the required gaps, and a completion meter. */
export function ReviewSummary({ counts, stats }: { counts: StatusCounts; stats: FactSheetStats | null }) {
  const percent = Math.round(completion(counts) * 100);
  const required = counts.requiredMissing;
  return (
    <div className="rounded-card border border-line bg-white p-4 shadow-card">
      <p className="eyebrow text-brand">Fact sheet</p>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <p className="text-2xl font-bold tracking-tight text-ink">{percent}%</p>
        <p className="text-xs text-ink-muted">
          {counts.found + counts.userProvided} of {counts.total} fields confirmed
        </p>
      </div>
      <Progress value={percent} className="mt-2" aria-label="Fields confirmed" />
      <p className="mt-3 text-sm text-ink-muted">
        <span className="font-semibold text-good">{counts.found} found</span>,{" "}
        <span className="font-semibold text-warn">{counts.conflict} contradicted</span>,{" "}
        <span className="font-semibold text-bad">{counts.missing} missing</span>
        {counts.userProvided > 0 ? (
          <>
            , <span className="font-semibold text-brand">{counts.userProvided} from you</span>
          </>
        ) : null}
      </p>
      {required > 0 ? (
        <p className="mt-3 rounded-lg bg-bad-soft px-2.5 py-1.5 text-xs font-medium text-bad">
          {required} required {plural(required, "field", "fields")} still {plural(required, "needs", "need")} an answer
        </p>
      ) : (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-good-soft px-2.5 py-1.5 text-xs font-medium text-good">
          <CircleCheck className="size-3.5" aria-hidden="true" />
          Every required field has an answer
        </p>
      )}
      {stats && stats.pagesUsed > 0 ? (
        <p className="mt-3 text-xs text-ink-soft">
          Built from {formatNumber(stats.pagesUsed)} {plural(stats.pagesUsed, "page", "pages")}
          {stats.findingsDropped > 0
            ? `. ${formatNumber(stats.findingsDropped)} ${plural(stats.findingsDropped, "finding", "findings")} dropped for lacking a quote.`
            : "."}
        </p>
      ) : null}
    </div>
  );
}
