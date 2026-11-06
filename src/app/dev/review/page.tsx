import { notFound } from "next/navigation";
import { ExistingSchemaPanel } from "@/components/app/review/existing-schema-panel";
import { FactSheetReview } from "@/components/app/review/fact-sheet-review";
import { PagesPanel } from "@/components/app/review/pages-panel";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import type { FactSheetRow, JsonLdBlock } from "@/lib/db/types";
import type { FactSheetData } from "@/lib/facts/types";
import { recomputeStats } from "@/lib/extract/merge";
import { schemaGroups, type PageDetail } from "@/lib/projects/view";
import { ABOUT_V1 } from "@/templates/about-v1";
import legiit from "../../../../examples/fixtures/legiit.factsheet.json";

/*
  Development-only preview of the review screen, fed by the Legiit fixture,
  so the screen can be checked without a database. 404 in production.
*/
export const dynamic = "force-dynamic";

const pages: PageDetail[] = [
  {
    id: "p1",
    url: "https://legiit.com/",
    title: "Legiit.com - Think Big",
    status: "extracted",
    rank: 0,
    reason: "home page",
    httpStatus: 200,
    textChars: 12129,
    error: null,
  },
  {
    id: "p2",
    url: "https://legiit.com/about",
    title: "About Legiit | Curated Freelance Marketplace",
    status: "extracted",
    rank: 1,
    reason: "about page",
    httpStatus: 200,
    textChars: 9840,
    error: null,
  },
  {
    id: "p3",
    url: "https://legiit.com/faq",
    title: null,
    status: "failed",
    rank: 2,
    reason: "faq page",
    httpStatus: 404,
    textChars: 0,
    error: "HTTP 404",
  },
];

const existingSchema: JsonLdBlock[] = [
  {
    data: {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Legiit",
      url: "https://legiit.com/",
      sameAs: ["https://www.youtube.com/@LegiitOfficial", "https://www.linkedin.com/company/legiit", "https://x.com/legiitcom"],
    },
    raw: "",
    types: ["Organization"],
  },
  { data: null, raw: "{ \"@type\": \"WebSite\", ", error: "Unexpected end of JSON input", types: [] },
];

export default function DevReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const data = legiit as unknown as FactSheetData;
  const stats = recomputeStats(ABOUT_V1, data);
  const factSheet: FactSheetRow = {
    id: "00000000-0000-0000-0000-000000000001",
    project_id: "00000000-0000-0000-0000-000000000002",
    user_id: "00000000-0000-0000-0000-000000000003",
    version: 1,
    source: "crawl",
    crawl_run_id: null,
    template_id: ABOUT_V1.id,
    data,
    existing_schema: existingSchema,
    stats,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
  const groups = schemaGroups(
    pages.map((p) => ({ ...p, jsonld: p.id === "p1" ? existingSchema : [] })),
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader userEmail="preview@example.com" />
      <main className="flex-1 bg-surface-alt">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <p className="eyebrow text-brand">Development preview</p>
          <h1 className="mt-2 text-2xl">Legiit</h1>
          <p className="mt-1 text-ink-muted">
            The review screen rendered from examples/fixtures/legiit.factsheet.json. Edits fail here
            because there is no API behind this page.
          </p>
          <div className="mt-8">
            <FactSheetReview
              factSheet={factSheet}
              spec={ABOUT_V1}
              pages={pages.map((p) => ({ id: p.id, url: p.url, title: p.title }))}
            />
          </div>
          <div className="mt-8 space-y-4">
            <PagesPanel pages={pages} />
            <ExistingSchemaPanel groups={groups} />
          </div>
        </div>
      </main>
      <SiteFooter signedIn />
    </div>
  );
}
