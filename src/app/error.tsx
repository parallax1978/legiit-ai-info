"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center bg-surface-alt px-4 py-16">
      <div className="w-full max-w-md rounded-card border border-line bg-white p-8 text-center shadow-card">
        <p className="eyebrow text-bad">Something went wrong</p>
        <h1 className="mt-2 text-2xl">The page could not load</h1>
        <p className="mt-3 text-ink-muted">
          Nothing you did caused this. Try again, and if it keeps happening, email help@legiit.com
          {error.digest ? ` with the code ${error.digest}` : ""}.
        </p>
        <div className="mt-6 flex justify-center">
          <Button variant="primary" size="sm" onClick={() => reset()}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
