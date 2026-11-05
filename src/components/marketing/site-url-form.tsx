import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
  The URL form from the hero and the closing band. Signed-out visitors go
  through /login with intent=new, which carries the site to /app/new after
  sign-in. Signed-in visitors go straight to /app/new.
*/
export function SiteUrlForm({
  id,
  signedIn = false,
  className,
  buttonLabel = "Scan my site",
}: {
  /** Unique per instance: the form appears twice on the landing page. */
  id: string;
  signedIn?: boolean;
  className?: string;
  buttonLabel?: string;
}) {
  return (
    <form
      action={signedIn ? "/app/new" : "/login"}
      method="get"
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", className)}
    >
      {signedIn ? null : <input type="hidden" name="intent" value="new" />}
      <label htmlFor={id} className="sr-only">
        Your website address
      </label>
      <input
        id={id}
        name="site"
        type="text"
        inputMode="url"
        autoComplete="url"
        required
        placeholder="yourbusiness.com"
        className="h-14 min-w-0 appearance-none rounded-full border border-white/15 bg-white/10 px-5 text-[17px] text-white placeholder:text-white/40 outline-none backdrop-blur focus:border-brand-soft focus:bg-white/15 sm:h-12 sm:flex-1 sm:text-base"
      />
      <Button type="submit" variant="primary" size="lg">
        {buttonLabel}
        <ChevronRight aria-hidden="true" />
      </Button>
    </form>
  );
}
