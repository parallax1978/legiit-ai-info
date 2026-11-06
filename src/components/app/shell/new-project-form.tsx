"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProject, normalizeSiteInput, type ProjectMode } from "@/lib/projects/client";

/*
  The website address, then two ways to start: scan the site, or fill the
  fact sheet in by hand. Both need the address, because the page's link and
  the schema are built from it.
*/
export function NewProjectForm({ initialSite = "" }: { initialSite?: string }) {
  const router = useRouter();
  const [site, setSite] = useState(initialSite);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ProjectMode | null>(null);

  async function start(mode: ProjectMode) {
    if (pending) return;
    const siteUrl = normalizeSiteInput(site);
    if (!siteUrl) {
      setError(
        mode === "manual"
          ? "Enter the address of the site first, like yourbusiness.com. The page and its schema need it even when you fill the facts in by hand."
          : "Enter the address of the site, like yourbusiness.com.",
      );
      return;
    }
    setError(null);
    setPending(mode);
    try {
      const { projectId } = await createProject(siteUrl, mode);
      router.push(`/app/projects/${projectId}`);
      // Stay disabled while the navigation happens.
    } catch (err) {
      setError(err instanceof Error ? err.message : "The project could not be created. Try again.");
      setPending(null);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void start("crawl");
  }

  const busy = pending !== null;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="site">Website address</Label>
        <Input
          id="site"
          name="site"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoFocus={!initialSite}
          required
          value={site}
          onChange={(e) => setSite(e.target.value)}
          placeholder="https://yourbusiness.com"
          className="h-12 rounded-lg px-3 text-base"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "site-error" : "site-hint"}
        />
        {error ? (
          <p id="site-error" role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : (
          <p id="site-hint" className="text-xs text-ink-muted">
            The home page is enough. We find the rest.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {pending === "crawl" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          {pending === "crawl" ? "Starting the scan" : "Scan the site"}
        </Button>
        <Button type="button" variant="secondary" size="lg" disabled={busy} onClick={() => void start("manual")}>
          {pending === "manual" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          {pending === "manual" ? "Setting up the fact sheet" : "Fill it in by hand instead"}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        By hand skips the scan: you answer each question yourself, one at a time. The address is still needed, for
        the page&apos;s link and the schema.
      </p>
    </form>
  );
}
