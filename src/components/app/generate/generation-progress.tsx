"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { RunLog } from "@/components/app/run/run-log";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ApiError, MAX_NETWORK_FAILURES, RETRY_DELAY_MS, errorMessage, stepGeneration } from "@/lib/generate/api";
import {
  GENERATION_STEPS,
  formatCost,
  generationStepIndex,
  isGenerationFinished,
  type GenerationView,
} from "@/lib/generate/view";
import { cn } from "@/lib/utils";

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
  Drives the generation from the browser the way run-progress drives a scan:
  POST step, render what it returns, call again. 409 means another tab holds
  the lock, so wait and retry. Network errors retry up to five times. Unmount
  aborts everything. When the generation finishes, the page is refreshed so
  the server renders the page screen (or the failure).
*/
export function GenerationProgress({ initial }: { initial: GenerationView }) {
  const router = useRouter();
  const [generation, setGeneration] = useState<GenerationView>(initial);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const current = useRef<GenerationView>(initial);

  const update = useCallback((next: GenerationView) => {
    current.current = next;
    setGeneration(next);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const loop = async () => {
      let failures = 0;
      while (!signal.aborted && !isGenerationFinished(current.current)) {
        try {
          const result = await stepGeneration(current.current.id, { signal });
          if (result.locked) {
            // Another step holds the lock. Not a success: a step that keeps dying at the
            // time limit shows up as 504s between 409s, and those still have to add up.
            if (result.generation) update(result.generation);
            await sleep(RETRY_DELAY_MS, signal);
            continue;
          }
          failures = 0;
          update(result.generation);
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

  const percent = Math.round(generation.progress * 100);
  const failed = generation.status === "failed";
  const finished = isGenerationFinished(generation);

  return (
    <section
      className="rounded-card border border-line bg-white p-5 shadow-card sm:p-6"
      aria-busy={!finished && !error}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("eyebrow", failed ? "text-bad" : "text-brand")}>
            {failed ? "Page failed" : "Writing the page"}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-lg sm:text-xl" aria-live="polite">
            {!finished && !error ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-brand" aria-hidden="true" />
            ) : null}
            <span className="min-w-0 break-words">{generation.message}</span>
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            This takes two or three minutes. You can leave this page; the writing picks up again when you come back.
          </p>
        </div>
        <span className="text-sm font-semibold tabular-nums text-ink-muted">{percent}%</span>
      </div>

      <Progress value={percent} className="mt-5" aria-label="Page progress" />

      <div className="mt-5">
        <GenerationSteps generation={generation} />
      </div>

      {generation.costUsd > 0 ? (
        <p className="mt-4 text-xs text-ink-soft">Cost so far: {formatCost(generation.costUsd)}</p>
      ) : null}

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
          {generation.status === "done" ? "Loading the page." : "Updating the page."}
        </p>
      ) : null}

      <div className="mt-5">
        <RunLog log={generation.log} />
      </div>
    </section>
  );
}

/*
  The four-step indicator: Write, Questions, Check, Build. Finished steps get
  a brand check, the current step is brand, the rest are muted.
*/
export function GenerationSteps({ generation }: { generation: Pick<GenerationView, "status" | "part"> }) {
  const index = generationStepIndex(generation);
  const failed = generation.status === "failed";
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Page steps">
      {GENERATION_STEPS.map((step, i) => {
        const done = index > i;
        const active = index === i && !failed;
        return (
          <li key={step.id} className="min-w-0">
            <div className={cn("h-1 rounded-full", done || active ? "bg-brand" : "bg-line", active && "animate-pulse")} />
            <div
              className={cn("mt-2 flex items-center gap-1 text-xs font-medium", done || active ? "text-brand" : "text-ink-soft")}
              aria-current={active ? "step" : undefined}
            >
              {done ? (
                <Check className="size-3.5 stroke-[3]" aria-hidden="true" />
              ) : (
                <span
                  className={cn("inline-block size-1.5 rounded-full", active ? "bg-brand" : "bg-line-strong")}
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{step.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
