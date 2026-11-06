"use client";

import Link from "next/link";
import { CircleCheck, ExternalLink } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FieldQuestion, LintIssueView } from "@/lib/generate/view";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { MarkdownView } from "./markdown-view";

export interface PageTabsProps {
  generationId: string;
  pageHtml: string;
  wordpressHtml: string;
  /** The schema, pretty-printed. */
  schemaJson: string;
  instructionsMd: string;
  /** Each field still to fill, with its question and the review screen link. */
  stillToFill: (FieldQuestion & { href: string })[];
  lint: { passed: boolean | null; attempts: number; issues: LintIssueView[] };
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-card border border-line bg-white shadow-card", className)}>{children}</div>;
}

function PanelBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">{children}</div>;
}

function CodePanel({ text, note, copyLabel }: { text: string; note: string; copyLabel: string }) {
  return (
    <Panel>
      <PanelBar>
        <p className="text-sm text-ink-muted">{note}</p>
        <CopyButton text={text} label={copyLabel} />
      </PanelBar>
      <pre className="max-h-[65vh] overflow-auto p-4 font-mono text-xs leading-5 text-ink">
        <code>{text}</code>
      </pre>
    </Panel>
  );
}

/*
  The page screen's tabs: a sandboxed preview, the two HTML files and the
  schema with copy buttons, the instructions rendered from markdown, the
  questions still to answer, and the lint issues that remain.
*/
export function PageTabs({ generationId, pageHtml, wordpressHtml, schemaJson, instructionsMd, stillToFill, lint }: PageTabsProps) {
  const fillCount = stillToFill.length;
  const lintCount = lint.issues.length;

  return (
    <Tabs defaultValue="preview">
      <div className="overflow-x-auto">
        <TabsList aria-label="Page outputs">
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="page">Page HTML</TabsTrigger>
          <TabsTrigger value="wordpress">WordPress HTML</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="instructions">Instructions</TabsTrigger>
          <TabsTrigger value="fill">{fillCount ? `Still to fill (${fillCount})` : "Still to fill"}</TabsTrigger>
          <TabsTrigger value="lint">{lintCount ? `Lint (${lintCount})` : "Lint"}</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="preview">
        <Panel>
          <PanelBar>
            <p className="text-sm text-ink-muted">
              Preview only. The styles here are not part of the page; your site&apos;s theme takes over once it is installed.
            </p>
            <a
              href={`/api/generations/${encodeURIComponent(generationId)}/html`}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "secondary", size: "xs" }))}
            >
              Open in a tab
              <ExternalLink aria-hidden="true" />
            </a>
          </PanelBar>
          <iframe title="Preview of the page" srcDoc={pageHtml} sandbox="" className="h-[70vh] w-full rounded-b-card bg-white" />
        </Panel>
      </TabsContent>

      <TabsContent value="page">
        <CodePanel
          text={pageHtml}
          note="The whole page: head, schema, a preview stylesheet, and the article. For a page template or a static site."
          copyLabel="Copy the HTML"
        />
      </TabsContent>

      <TabsContent value="wordpress">
        <CodePanel
          text={wordpressHtml}
          note="The article with the schema script first. Paste it into a Custom HTML block or an HTML embed."
          copyLabel="Copy the HTML"
        />
      </TabsContent>

      <TabsContent value="schema">
        <CodePanel
          text={schemaJson}
          note="The JSON-LD on its own, for the head of the page or a schema plugin."
          copyLabel="Copy the schema"
        />
      </TabsContent>

      <TabsContent value="instructions">
        <Panel>
          <PanelBar>
            <p className="text-sm text-ink-muted">Where each file goes, and how to check the result.</p>
            <CopyButton text={instructionsMd} label="Copy as markdown" />
          </PanelBar>
          <MarkdownView markdown={instructionsMd} className="p-5 sm:p-6" />
        </Panel>
      </TabsContent>

      <TabsContent value="fill">
        <Panel className="p-5 sm:p-6">
          {fillCount === 0 ? (
            <p className="inline-flex items-center gap-2 text-sm text-good">
              <CircleCheck className="size-4" aria-hidden="true" />
              Every required fact made it onto the page.
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-muted">
                The page leaves a note where each of these belongs. Answer them on the review screen, then generate the
                page again.
              </p>
              <ul className="mt-4 divide-y divide-line">
                {stillToFill.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{f.label}</p>
                      <p className="mt-0.5 text-sm text-ink-muted">{f.question}</p>
                    </div>
                    <Link href={f.href} className={cn(buttonVariants({ variant: "secondary", size: "xs" }))}>
                      Answer
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </TabsContent>

      <TabsContent value="lint">
        <Panel className="p-5 sm:p-6">
          {lint.passed === null ? (
            <p className="text-sm text-ink-muted">No report was stored for this page.</p>
          ) : lintCount === 0 ? (
            <p className="inline-flex items-center gap-2 text-sm text-good">
              <CircleCheck className="size-4" aria-hidden="true" />
              The copy passed every check
              {lint.attempts > 0 ? ` after ${lint.attempts === 1 ? "one rewrite" : `${lint.attempts} rewrites`}` : ""}.
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-muted">
                {lintCount === 1 ? "One issue remains" : `${lintCount} issues remain`}
                {lint.attempts > 0 ? ` after ${lint.attempts === 1 ? "one rewrite" : `${lint.attempts} rewrites`}` : ""}. Fix
                them in the HTML before you publish, or answer the questions on the review screen and generate the
                page again.
              </p>
              <ul className="mt-4 divide-y divide-line">
                {lint.issues.map((issue, i) => (
                  <li key={i} className="py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{issue.where}</p>
                    <p className="mt-1 font-semibold text-ink">{issue.kind}</p>
                    {issue.text ? (
                      <p className="mt-1 rounded-lg bg-surface-sunken px-2.5 py-1.5 text-sm text-ink-muted">{issue.text}</p>
                    ) : null}
                    {issue.hint ? <p className="mt-1 text-sm text-ink-muted">{issue.hint}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </TabsContent>
    </Tabs>
  );
}
