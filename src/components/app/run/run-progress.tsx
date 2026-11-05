"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ApiError, MAX_NETWORK_FAILURES, RETRY_DELAY_MS, errorMessage, stepRun } from "@/lib/projects/api";
import { formatNumber, isRunFinished, type RunView } from "@/lib/projects/view";
import { cn } from "@/lib/utils";
import { PhaseSteps } from "./phase-steps";
import { RunLog } from "./run-log";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

/*
  Drives the step loop from the browser: POST step, render the run it
  returns, call again. 409 means another tab holds the lock, so wait and
  retry. Network errors retry up to five times. Unmount aborts everything.
  When the run finishes, the page is refreshed so the server renders the
  fact sheet (or the failure).
*/
export function RunProgress({ initial }: { initial: RunView }) {
  const router = useRouter();
  const [run, setRun] = useState<RunView>(initial);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const runRef = useRef<RunView>(initial);

  const update = useCallback((next: RunView) => {
    runRef.current = next;
    setRun(next);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const loop = async () => {
      let failures = 0;
      while (!signal.aborted && !isRunFinished(runRef.current)) {
        try {
          const result = await stepRun(runRef.current.id, { signal });
          failures = 0;
          if (result.locked) {
            if (result.run) update(result.run);
            await sleep(RETRY_DELAY_MS, signal);
            continue;
          }
          update(result.run);
        } catch (e) {
          if (signal.aborted) return;
          if (e instanceof ApiError && e.status < 500) {
            setError(e.message);
            return;
          }
          failures += 1;
          if (failures >= MAX_NETWORK_FAILURES) {
            setError(errorMessage(e));
            return;
          }
          await sleep(RETRY_DELAY_MS, signal);
        }
      }
      if (signal.aborted) return;
      setRefreshing(true);
      router.refresh();
    };

    void loop();
    return () => controller.abort();
  }, [attempt, router, update]);

  const retry = () => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  const percent = Math.round(run.progress * 100);
  const failed = run.status === "failed" || run.phase === "failed";
  const finished = isRunFinished(run);

  return (
    <section
      className="rounded-card border border-line bg-white p-5 shadow-card sm:p-6"
      aria-busy={!finished && !error}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("eyebrow", failed ? "text-bad" : "text-brand")}>{failed ? "Scan failed" : "Scanning"}</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg sm:text-xl" aria-live="polite">
            {!finished && !error ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-brand" aria-hidden="true" />
            ) : null}
            <span className="min-w-0 break-words">{run.message}</span>
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            This takes a minute or two. You can leave this page; the scan continues when you come back.
          </p>
        </div>
        <span className="text-sm font-semibold tabular-nums text-ink-muted">{percent}%</span>
      </div>

      <Progress value={percent} className="mt-5" aria-label="Scan progress" />

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Counter label="Planned" value={run.pagesPlanned} />
        <Counter label="Read" value={run.pagesFetched} />
        <Counter label="Failed" value={run.pagesFailed} tone={run.pagesFailed > 0 ? "warn" : undefined} />
        <Counter label="Extracted" value={run.pagesExtracted} />
      </div>

      <div className="mt-5">
        <PhaseSteps phase={run.phase} failed={failed} />
      </div>

      {error ? (
        <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <Button variant="primary" size="xs" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : null}

      {refreshing && !error ? (
        <p className="mt-5 text-sm text-ink-muted" aria-live="polite">
          {run.done
            ? run.factSheetId
              ? "Loading the fact sheet."
              : "The scan finished without a fact sheet. Run it again from the menu above."
            : "Updating the page."}
        </p>
      ) : null}

      <div className="mt-5">
        <RunLog log={run.log} />
      </div>
    </section>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-lg bg-surface-alt px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">{label}</p>
      <p className={cn("mt-0.5 text-lg font-bold tabular-nums", tone === "warn" ? "text-warn" : "text-ink")}>
        {formatNumber(value)}
      </p>
    </div>
  );
}
