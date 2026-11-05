"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function digestOf(error: unknown): string | null {
  if (!(error instanceof Error) || !("digest" in error)) return null;
  return typeof error.digest === "string" && error.digest ? error.digest : null;
}

/*
  Errors inside the signed-in app render here, inside the app shell, so the
  header and footer stay and the person can get back to their projects.
*/
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = digestOf(error);

  return (
    <div className="mx-auto w-full max-w-md rounded-card border border-line bg-white p-8 text-center shadow-card">
      <p className="eyebrow text-bad">Something went wrong</p>
      <h1 className="mt-2 text-2xl">This page could not load</h1>
      <p className="mt-3 text-ink-muted">
        Your projects and fact sheets are safe. Try again, and if it keeps happening, email help@legiit.com
        {digest ? ` with the code ${digest}` : ""}.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/app" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          Your projects
        </Link>
        {/* retry() fetches the page from the server again. */}
        <Button variant="primary" size="sm" onClick={() => retry()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
