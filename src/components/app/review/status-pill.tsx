import type { ReactNode } from "react";
import { CircleCheck, CircleX, Clock, Minus, TriangleAlert, User } from "lucide-react";
import type { PageStatusT } from "@/lib/db/types";
import type { FactStatus } from "@/lib/facts/types";
import { pageStatusLabel, statusLabel } from "@/lib/projects/view";
import { cn } from "@/lib/utils";

export type PillTone = "good" | "warn" | "bad" | "brand" | "muted";

const TONES: Record<PillTone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  brand: "bg-brand-faint text-brand",
  muted: "bg-surface-sunken text-ink-muted",
};

/** The small rounded status marker used across the product screens. */
export function Pill({
  tone = "muted",
  className,
  children,
  title,
}: {
  tone?: PillTone;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<FactStatus, PillTone> = {
  found: "good",
  conflict: "warn",
  missing: "bad",
  user_provided: "brand",
};

export function StatusPill({ status, className }: { status: FactStatus; className?: string }) {
  const Icon =
    status === "found" ? CircleCheck : status === "conflict" ? TriangleAlert : status === "missing" ? CircleX : User;
  return (
    <Pill tone={STATUS_TONE[status]} className={className}>
      <Icon aria-hidden="true" />
      {statusLabel(status)}
    </Pill>
  );
}

const PAGE_TONE: Record<PageStatusT, PillTone> = {
  queued: "muted",
  fetched: "good",
  extracted: "good",
  skipped: "muted",
  failed: "bad",
};

export function PageStatusPill({ status }: { status: PageStatusT }) {
  const Icon =
    status === "fetched" || status === "extracted"
      ? CircleCheck
      : status === "failed"
        ? CircleX
        : status === "queued"
          ? Clock
          : Minus;
  return (
    <Pill tone={PAGE_TONE[status]}>
      <Icon aria-hidden="true" />
      {pageStatusLabel(status)}
    </Pill>
  );
}
