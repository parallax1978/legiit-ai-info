"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createProject, normalizeSiteInput } from "@/lib/projects/client";

export function NewProjectForm({ initialSite = "" }: { initialSite?: string }) {
  const router = useRouter();
  const [site, setSite] = useState(initialSite);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const siteUrl = normalizeSiteInput(site);
    if (!siteUrl) {
      setError("Enter the address of the site, like yourbusiness.com.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const { projectId } = await createProject(siteUrl);
      router.push(`/app/projects/${projectId}`);
      // Stay disabled while the navigation happens.
    } catch (err) {
      setError(err instanceof Error ? err.message : "The project could not be created. Try again.");
      setPending(false);
    }
  }

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
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Starting the scan" : "Scan the site"}
        </Button>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>
            <Button type="button" variant="secondary" size="lg" disabled aria-disabled="true">
              Fill it in by hand instead
            </Button>
          </TooltipTrigger>
          <TooltipContent>Coming in the next release</TooltipContent>
        </Tooltip>
      </div>
    </form>
  );
}
