import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center bg-surface-alt px-4 py-16">
        <div className="w-full max-w-md rounded-card border border-line bg-white p-8 text-center shadow-card">
          <p className="eyebrow text-brand">404</p>
          <h1 className="mt-2 text-2xl">That page is not here</h1>
          <p className="mt-3 text-ink-muted">
            The link may be old, or the project may belong to another account.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              Home
            </Link>
            <Link href="/app" className={cn(buttonVariants({ variant: "primary", size: "sm" }))}>
              Your projects
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
