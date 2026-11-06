"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAccessCode, errorMessage, type AccessCodeSummary } from "@/lib/billing/client";

/*
  The admin's "Make a code" form: a label, how many times it may be used,
  and an optional last day. The new code shows with a Copy button, since the
  admin's next step is to send it to someone.
*/
export function CreateCodeForm() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expires, setExpires] = useState("");
  const [pending, setPending] = useState(false);
  const [made, setMade] = useState<AccessCodeSummary | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const uses = Number.parseInt(maxUses, 10);
    if (!Number.isInteger(uses) || uses < 1) {
      toast.error("Max uses has to be a whole number of 1 or more.");
      return;
    }
    setPending(true);
    try {
      const code = await createAccessCode({
        label: label.trim() || undefined,
        maxUses: uses,
        // The last day the code works, to the end of that day in UTC.
        expiresAt: expires ? `${expires}T23:59:59Z` : null,
      });
      setMade(code);
      setCopied(false);
      setLabel("");
      setMaxUses("1");
      setExpires("");
      toast.success("Code made");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.code);
      setCopied(true);
    } catch {
      toast.error("Copy did not work. Select the code and copy it by hand.");
    }
  }

  return (
    <div className="rounded-card border border-line bg-white p-6 shadow-card">
      <h2 className="text-base font-semibold text-ink">Make a code</h2>
      <form onSubmit={submit} noValidate className="mt-4 grid gap-4 sm:grid-cols-[1fr_8rem_11rem_auto] sm:items-end">
        <div>
          <Label htmlFor="code-label">Label</Label>
          <Input
            id="code-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Spring cohort"
            maxLength={200}
            className="mt-1.5 h-10"
          />
        </div>
        <div>
          <Label htmlFor="code-max-uses">Max uses</Label>
          <Input
            id="code-max-uses"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            className="mt-1.5 h-10"
          />
        </div>
        <div>
          <Label htmlFor="code-expires">Last day (optional)</Label>
          <Input id="code-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="mt-1.5 h-10" />
        </div>
        <Button type="submit" variant="primary" size="md" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
          Make the code
        </Button>
      </form>

      {made ? (
        <div className="mt-4 flex flex-col gap-2 rounded-lg bg-brand-faint p-4 sm:flex-row sm:items-center" aria-live="polite">
          <p className="min-w-0 flex-1 text-sm text-ink">
            New code{made.label ? ` for ${made.label}` : ""}:{" "}
            <code className="font-mono text-base font-semibold tracking-wider text-brand-strong">{made.code}</code>
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
