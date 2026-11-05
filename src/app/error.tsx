"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** The digest Next attaches to a Server Component error, for matching the server log. */
function digestOf(error: unknown): string | null {
  if (!(error instanceof Error) || !("digest" in error)) return null;
  return typeof error.digest === "string" && error.digest ? error.digest : null;
}

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = digestOf(error);

  return (
    <main className="flex flex-1 items-center justify-center bg-surface-alt px-4 py-16">
      <div className="w-full max-w-md rounded-card border border-line bg-white p-8 text-center shadow-card">
        <p className="eyebrow text-bad">Something went wrong</p>
        <h1 className="mt-2 text-2xl">The page could not load</h1>
        <p className="mt-3 text-ink-muted">
          Nothing you did caused this. Try again, and if it keeps happening, email help@legiit.com
          {digest ? ` with the code ${digest}` : ""}.
        </p>
        <div className="mt-6 flex justify-center">
          {/* retry() fetches the page from the server again; reset() would only re-render the failed result. */}
          <Button variant="primary" size="sm" onClick={() => retry()}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
