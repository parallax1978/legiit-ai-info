import type { ProjectStatusT } from "@/lib/db/types";
import { cn } from "@/lib/utils";

const styles: Record<ProjectStatusT, { label: string; className: string }> = {
  new: { label: "New", className: "bg-warn-soft text-warn" },
  crawling: { label: "Scanning", className: "bg-warn-soft text-warn" },
  review: { label: "Review", className: "bg-brand-faint text-brand-strong" },
  generating: { label: "Writing", className: "bg-warn-soft text-warn" },
  ready: { label: "Ready", className: "bg-good-soft text-good" },
  failed: { label: "Failed", className: "bg-bad-soft text-bad" },
};

export function StatusPill({ status, className }: { status: ProjectStatusT; className?: string }) {
  const s = styles[status] ?? { label: status, className: "bg-surface-sunken text-ink-muted" };
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold",
        s.className,
        className,
      )}
    >
      {s.label}
    </span>
  );
}
