"use client";

import { useState } from "react";
import { Link2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createShareLink, errorMessage, revokeShareLink } from "@/lib/generate/api";
import { CopyButton } from "./copy-button";

/*
  "Share": makes the public link (or fetches the one that exists) and shows
  it in a dialog with Copy and Revoke. The link is served by /s/[token] for
  30 days and is marked noindex; revoking it makes the URL stop working.
*/
export function ShareControls({
  generationId,
  initialHasLink = false,
  variant = "secondary",
  size = "sm",
}: {
  generationId: string;
  /** True when a link already exists, so the button says so before it is opened. */
  initialHasLink?: boolean;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "xs" | "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [hasLink, setHasLink] = useState(initialHasLink);
  const [pending, setPending] = useState<"create" | "revoke" | null>(null);

  // The route makes the link or returns the existing one, so the URL always comes from it.
  const share = async () => {
    setOpen(true);
    if (url || pending) return;
    setPending("create");
    try {
      const result = await createShareLink(generationId);
      setUrl(result.url);
      setHasLink(true);
    } catch (e) {
      toast.error(errorMessage(e));
      setOpen(false);
    } finally {
      setPending(null);
    }
  };

  const revoke = async () => {
    if (pending) return;
    setPending("revoke");
    try {
      await revokeShareLink(generationId);
      setUrl(null);
      setHasLink(false);
      setOpen(false);
      toast.success("The share link no longer works");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={() => void share()}>
        <Link2 aria-hidden="true" />
        {hasLink ? "Share link" : "Share"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Share this page</DialogTitle>
            <DialogDescription>
              Anyone with the link can view the page as it will look on your site. The link works for 30 days, and
              search engines are told not to index it.
            </DialogDescription>
          </DialogHeader>

          {url ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input value={url} readOnly aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={url} label="Copy link" size="sm" className="shrink-0" />
            </div>
          ) : (
            <p className="inline-flex items-center gap-2 text-sm text-ink-muted" aria-live="polite">
              <LoaderCircle className="size-4 animate-spin text-brand" aria-hidden="true" />
              Making the link
            </p>
          )}

          <DialogFooter>
            {url ? (
              <Button variant="destructive" size="sm" disabled={pending !== null} onClick={() => void revoke()}>
                {pending === "revoke" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                Revoke the link
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
