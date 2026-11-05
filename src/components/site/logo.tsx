import Link from "next/link";
import { ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  The logo mark and wordmark, rendered the way legiitkeywords.com renders
  "Legiit" + "Keywords": a gradient square with a white lucide glyph, then the
  wordmark with the product part in brand.
*/
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "brand-gradient inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-glow",
        className,
      )}
      aria-hidden="true"
    >
      <ScanSearch className="h-3.5 w-3.5 stroke-[2.5]" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[15px] font-bold tracking-tight text-ink", className)}>
      Legiit<span className="text-brand">Ai Info</span>
    </span>
  );
}

export function Logo({ href = "/", withMark = true }: { href?: string; withMark?: boolean }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2" aria-label="Legiit Ai Info">
      {withMark ? <LogoMark /> : null}
      <Wordmark />
    </Link>
  );
}
