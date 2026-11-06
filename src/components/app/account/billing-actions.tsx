"use client";

import { useState } from "react";
import { CreditCard, ExternalLink, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage, openBillingPortal, startCheckout } from "@/lib/billing/client";

type Variant = "primary" | "secondary" | "outline" | "ghost";
type Size = "xs" | "sm" | "md" | "lg";

interface ButtonProps {
  label?: string;
  variant?: Variant;
  size?: Size;
  className?: string;
}

/*
  The two billing buttons. Each asks the server for a Stripe page and sends
  the browser there; the server makes the session, so no key or price id
  reaches the browser. On an error (billing not set up, no billing account
  yet) the server's plain message shows as a toast.
*/
function useStripePage(load: () => Promise<{ url: string }>) {
  const [pending, setPending] = useState(false);
  const go = async () => {
    if (pending) return;
    setPending(true);
    try {
      const { url } = await load();
      window.location.assign(url);
      // Stays disabled while the browser leaves the page.
    } catch (e) {
      toast.error(errorMessage(e));
      setPending(false);
    }
  };
  return { pending, go };
}

/** Starts Stripe Checkout for the paid plan. */
export function UpgradeButton({ label = "Upgrade", variant = "primary", size = "md", className }: ButtonProps) {
  const { pending, go } = useStripePage(startCheckout);
  return (
    <Button variant={variant} size={size} className={className} disabled={pending} onClick={() => void go()}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
      {label}
    </Button>
  );
}

/** Opens the Stripe Billing Portal: change the card, see invoices, cancel. */
export function ManageBillingButton({ label = "Manage billing", variant = "secondary", size = "md", className }: ButtonProps) {
  const { pending, go } = useStripePage(openBillingPortal);
  return (
    <Button variant={variant} size={size} className={className} disabled={pending} onClick={() => void go()}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ExternalLink aria-hidden="true" />}
      {label}
    </Button>
  );
}
