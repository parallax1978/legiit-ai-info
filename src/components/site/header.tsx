import Link from "next/link";
import { AccountMenu } from "./account-menu";
import { Logo } from "./logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface HeaderProps {
  /** Signed-in email, when known. Switches the nav to the app links. */
  userEmail?: string | null;
  isAdmin?: boolean;
}

/*
  Sticky header from legiitkeywords.com: white at 90% with blur, bottom line,
  max-w-5xl container, muted links hidden on mobile, one small pill CTA.
  Signed in, phones get a menu button in place of the hidden links.
*/
export function SiteHeader({ userEmail, isAdmin }: HeaderProps) {
  const signedIn = Boolean(userEmail);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Logo href={signedIn ? "/app" : "/"} />
        <nav className="flex items-center gap-5 text-sm">
          {signedIn ? (
            <>
              <Link href="/app" className="hidden text-ink-muted hover:text-ink sm:inline">
                Projects
              </Link>
              {isAdmin ? (
                <Link href="/admin" className="hidden text-ink-muted hover:text-ink sm:inline">
                  Admin
                </Link>
              ) : null}
              <Link href="/account" className="hidden text-ink-muted hover:text-ink sm:inline">
                Account
              </Link>
              <form action="/auth/sign-out" method="post" className="hidden sm:inline">
                <button type="submit" className="text-ink-muted hover:text-ink">
                  Sign out
                </button>
              </form>
              <Link
                href="/app/new"
                className={cn(buttonVariants({ variant: "primary", size: "xs" }))}
              >
                New project
              </Link>
              <AccountMenu isAdmin={isAdmin} className="sm:hidden" />
            </>
          ) : (
            <>
              <Link href="/#how" className="hidden text-ink-muted hover:text-ink sm:inline">
                How It Works
              </Link>
              <Link href="/#pricing" className="hidden text-ink-muted hover:text-ink sm:inline">
                Pricing
              </Link>
              <Link href="/#faq" className="hidden text-ink-muted hover:text-ink sm:inline">
                FAQ
              </Link>
              <Link href="/login" className="hidden text-ink-muted hover:text-ink sm:inline">
                Sign In
              </Link>
              <Link
                href="/login?intent=new"
                className={cn(buttonVariants({ variant: "primary", size: "xs" }))}
              >
                Scan Your Site
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
