"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage, startGeneration } from "@/lib/generate/api";
import { cn } from "@/lib/utils";
import { useGenerateState } from "./generate-context";

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "xs" | "sm" | "md" | "lg";

/*
  Starts a generation and goes to the page screen. With required facts still
  missing, a dialog lists them first, with "Generate anyway" (the page leaves
  a note where each one belongs) and "Fill the gaps" back to the review.
  Disabled, with the reason in a tooltip, until there is a fact sheet, and
  while a page is being written.
*/
export function GenerateButton({
  label = "Generate the page",
  variant = "primary",
  size = "sm",
}: {
  label?: string;
  variant?: Variant;
  size?: Size;
}) {
  const state = useGenerateState();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  const start = async () => {
    if (!state || pending) return;
    setPending(true);
    try {
      await startGeneration(state.projectId);
      setOpen(false);
      router.push(`/app/projects/${state.projectId}/page`);
      // Stay disabled while the navigation happens.
    } catch (e) {
      toast.error(errorMessage(e));
      setPending(false);
    }
  };

  const onClick = () => {
    if (!state) return;
    if (state.missing.length) {
      setOpen(true);
      return;
    }
    void start();
  };

  const reason = !state
    ? "Not available here"
    : !state.hasFactSheet
      ? "Scan the site, or fill in the fact sheet by hand, first"
      : state.busy
        ? "A page is being written now"
        : null;
  const disabled = reason !== null || pending;

  const button = (
    <Button variant={variant} size={size} disabled={disabled} aria-disabled={disabled || undefined} onClick={onClick}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
      {label}
    </Button>
  );

  return (
    <>
      {reason ? (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>{button}</TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}

      {state ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Some required facts are still missing</DialogTitle>
              <DialogDescription>
                The page can be written without them. It leaves a note where each one belongs, and the Still to fill
                tab lists the questions.
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-72 space-y-2 overflow-y-auto text-sm" aria-label="Missing required facts">
              {state.missing.map((f) => (
                <li key={f.id} className="rounded-lg bg-surface-alt px-3 py-2">
                  <p className="font-semibold text-ink">{f.label}</p>
                  <p className="mt-0.5 text-ink-muted">{f.question}</p>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Link
                href={state.reviewHref}
                onClick={() => setOpen(false)}
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                Fill the gaps
              </Link>
              <Button variant="primary" size="sm" disabled={pending} onClick={() => void start()}>
                {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                Generate anyway
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
