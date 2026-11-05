"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LoaderCircle, RefreshCw, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { errorMessage, startRun } from "@/lib/projects/api";

type Mode = "reuse" | "crawl";

function useStartRun(projectId: string) {
  const router = useRouter();
  const [pending, setPending] = useState<Mode | null>(null);

  async function start(mode: Mode) {
    if (pending) return;
    setPending(mode);
    try {
      await startRun(projectId, { reusePages: mode === "reuse" });
      toast.success(mode === "reuse" ? "Re-reading the saved pages" : "Scan started");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(null);
    }
  }

  return { pending, start };
}

/*
  "Run the scan again" with two choices: re-read the stored pages (skips
  fetching) or re-crawl the site. Starting a run refreshes the page so the
  server renders the new run's progress.
*/
export function RerunControls({
  projectId,
  canReuse = true,
  disabled = false,
  label = "Run the scan again",
}: {
  projectId: string;
  /** False when the project has no stored pages to re-read. */
  canReuse?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const { pending, start } = useStartRun(projectId);
  const busy = pending !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" size="sm" disabled={disabled || busy} />}>
        {busy ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw aria-hidden="true" />
        )}
        {label}
        <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-72 p-1.5">
        <DropdownMenuItem
          disabled={!canReuse}
          onClick={() => void start("reuse")}
          className="flex-col items-start gap-0.5 px-2.5 py-2"
        >
          <span className="font-medium text-ink">Re-read the pages</span>
          <span className="text-xs text-ink-muted">
            {canReuse
              ? "Uses the pages already saved and pulls the facts again. Faster."
              : "No saved pages yet. Re-crawl the site first."}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void start("crawl")} className="flex-col items-start gap-0.5 px-2.5 py-2">
          <span className="font-medium text-ink">Re-crawl the site</span>
          <span className="text-xs text-ink-muted">Fetches every page again, then pulls the facts.</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The first scan for a project that has none. */
export function StartScanButton({ projectId }: { projectId: string }) {
  const { pending, start } = useStartRun(projectId);
  return (
    <Button variant="primary" size="md" disabled={pending !== null} onClick={() => void start("crawl")}>
      {pending ? (
        <LoaderCircle className="animate-spin" aria-hidden="true" />
      ) : (
        <ScanSearch aria-hidden="true" />
      )}
      Start the scan
    </Button>
  );
}
