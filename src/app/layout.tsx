import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { config } from "@/config";

export const metadata: Metadata = {
  metadataBase: new URL(config.site.url),
  title: {
    default: config.site.name,
    template: `%s | ${config.site.name}`,
  },
  description: config.site.description,
  applicationName: config.site.name,
  openGraph: {
    title: config.site.name,
    description: config.site.description,
    url: config.site.url,
    siteName: config.site.name,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: `${config.site.name}: an About page built from your own site, with the proof` }],
  },
  twitter: {
    card: "summary_large_image",
    title: config.site.name,
    description: config.site.description,
    images: ["/og.png"],
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
