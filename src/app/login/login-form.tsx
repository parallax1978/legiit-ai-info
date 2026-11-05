"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendMagicLink, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm({
  next,
  initialEmail,
  initialError,
}: {
  next: string;
  initialEmail?: string;
  /** A message from a previous step (an expired link), shown until the form is used. */
  initialError?: string | null;
}) {
  const [state, formAction, pending] = useActionState(sendMagicLink, initialState);
  const error = state.error ?? initialError ?? null;

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.email ?? initialEmail ?? ""}
          placeholder="you@yourbusiness.com"
          className="h-11 rounded-lg px-3 text-base"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>
      {error ? (
        <p id="login-error" role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? "Sending the link" : "Email me a link"}
      </Button>
    </form>
  );
}
