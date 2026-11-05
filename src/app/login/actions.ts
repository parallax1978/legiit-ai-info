"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { originFromHeaders, safeNext } from "@/app/auth/redirects";

export type LoginState = {
  error: string | null;
  /** The address the user typed, so the form keeps it after an error. */
  email?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function callbackUrl(next: string): Promise<string> {
  const origin = originFromHeaders(await headers());
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

/** Emails a one-time sign-in link. Used with useActionState, so it returns the error state. */
export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const next = safeNext(formData.get("next"));

  if (!EMAIL_RE.test(email)) {
    return { error: "Enter the email address the link should go to.", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: await callbackUrl(next) },
  });

  if (error) return { error: error.message, email };

  redirect(
    `/login?sent=1&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`,
  );
}

/** Starts the Google OAuth flow and sends the browser to Google. */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: await callbackUrl(next) },
  });

  if (error || !data.url) {
    redirect(`/login?error=google&next=${encodeURIComponent(next)}`);
  }

  redirect(data.url);
}
