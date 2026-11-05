import Link from "next/link";
import { config } from "@/config";
import { Wordmark } from "./logo";

const legalLinks = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms" },
  { href: "/cookies", label: "Cookie Policy" },
  { href: "/gdpr", label: "GDPR" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/disclaimer", label: "Disclaimer" },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-ink-muted">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2">
            <Link href="/" className="inline-flex items-center gap-2" aria-label="Legiit Ai Info">
              <Wordmark />
            </Link>
            <span>
              · A{" "}
              <a
                href={config.site.parentUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium hover:text-ink"
              >
                Legiit
              </a>{" "}
              product
            </span>
          </p>
          <nav className="grid w-full grid-cols-3 gap-x-4 gap-y-2 whitespace-nowrap sm:flex sm:w-auto sm:items-center sm:gap-4">
            <Link href="/#how" className="hover:text-ink">
              How It Works
            </Link>
            <Link href="/#pricing" className="hover:text-ink">
              Pricing
            </Link>
            <Link href="/#faq" className="hover:text-ink">
              FAQ
            </Link>
            <a href={`mailto:${config.site.supportEmail}`} className="hover:text-ink">
              Support
            </a>
            <Link href="/login" className="hover:text-ink">
              Sign In
            </Link>
          </nav>
        </div>
        <nav
          aria-label="Legal"
          className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-5 text-xs sm:flex sm:flex-wrap sm:gap-x-5"
        >
          {legalLinks.map((l) => (
            <Link key={l.href} href={l.href} className="font-medium hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="mt-4 text-xs">
          © {year} {config.site.legalOwner}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
