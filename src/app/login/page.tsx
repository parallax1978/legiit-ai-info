import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark, Wordmark } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { safeNext } from "@/app/auth/redirects";
import { signInWithGoogle } from "./actions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Where to go after sign-in. A "scan this site" intent jumps straight to the new project form. */
function nextFromParams(sp: SearchParams): string {
  const intent = first(sp.intent);
  const site = first(sp.site)?.trim();
  if (intent === "new" && site) return `/app/new?site=${encodeURIComponent(site)}`;
  return safeNext(first(sp.next));
}

const errorMessages: Record<string, string> = {
  link: "That sign-in link did not work. It may have expired or already been used. Ask for a new one.",
  google: "Google sign-in did not start. Try the email link instead.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const next = nextFromParams(sp);
  const sent = first(sp.sent) === "1";
  const email = first(sp.email)?.trim() ?? "";
  const errorCode = first(sp.error);
  const error = errorCode ? (errorMessages[errorCode] ?? "Something went wrong. Try again.") : null;
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";

  return (
    <main className="flex flex-1 items-center justify-center bg-surface-alt px-4 py-16">
      <div className="w-full max-w-md rounded-card border border-line bg-white p-8 shadow-card">
        <Link href="/" className="inline-flex items-center gap-2" aria-label="Legiit Ai Info">
          <LogoMark className="h-9 w-9 rounded-xl" />
          <Wordmark />
        </Link>

        {sent ? (
          <>
            <h1 className="mt-6 text-2xl">Check your email</h1>
            <p className="mt-2 text-ink-muted">
              We sent a sign-in link to <span className="font-medium text-ink">{email || "your address"}</span>.
              Open it on this device to continue.
            </p>
            <p className="mt-4 text-sm text-ink-muted">
              The link works once. If it has not arrived in a few minutes, check your spam folder, then ask
              for a new one.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="mt-6 inline-block text-sm font-medium text-brand hover:underline"
            >
              Use a different email
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-2xl">Sign in</h1>
            <p className="mt-2 text-ink-muted">No password. We email you a link.</p>

            <LoginForm next={next} initialEmail={email} initialError={error} />

            {googleEnabled ? (
              <>
                <div className="my-5 flex items-center gap-3 text-xs text-ink-soft">
                  <span className="h-px flex-1 bg-line" />
                  or
                  <span className="h-px flex-1 bg-line" />
                </div>
                <form action={signInWithGoogle}>
                  <input type="hidden" name="next" value={next} />
                  <Button type="submit" variant="secondary" size="lg" className="w-full">
                    Continue with Google
                  </Button>
                </form>
              </>
            ) : null}

            <p className="mt-6 text-xs leading-relaxed text-ink-soft">
              New here? The same link creates your account. By signing in you agree to the{" "}
              <Link href="/terms" className="font-medium text-ink-muted hover:text-ink">
                terms
              </Link>{" "}
              and the{" "}
              <Link href="/privacy" className="font-medium text-ink-muted hover:text-ink">
                privacy policy
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </main>
  );
}
