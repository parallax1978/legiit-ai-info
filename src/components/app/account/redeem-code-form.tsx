"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, redeemAccessCode } from "@/lib/billing/client";

/*
  "Redeem an access code": one field and a button. The server checks the
  code and sets the plan; a refusal shows under the field in the server's
  words, and a success refreshes the page so the plan and allowance update.
*/
export function RedeemCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const value = code.trim();
    if (!value) {
      setError("Enter your code.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await redeemAccessCode(value);
      toast.success(result.message);
      setCode("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="min-w-0 flex-1">
        <Label htmlFor="access-code-input">Access code</Label>
        <Input
          id="access-code-input"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABCD EFGH JKLM"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          className="mt-1.5 h-10 font-mono tracking-wider uppercase"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "access-code-error" : undefined}
        />
      </div>
      <Button type="submit" variant="secondary" size="md" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Ticket aria-hidden="true" />}
        Redeem
      </Button>
      {error ? (
        <p id="access-code-error" role="alert" className="text-sm text-bad sm:basis-full">
          {error}
        </p>
      ) : null}
    </form>
  );
}
