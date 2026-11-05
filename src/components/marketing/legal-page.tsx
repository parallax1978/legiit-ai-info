/*
  One shape for the legal pages the footer links to: an H1, a lede, sections
  with short paragraphs, and the date the text was last changed.
*/
export interface LegalSection {
  heading?: string;
  paragraphs: React.ReactNode[];
}

export function LegalPage({
  title,
  lede,
  sections,
  updated,
}: {
  title: string;
  lede: string;
  sections: LegalSection[];
  updated: string;
}) {
  return (
    <main className="flex-1 bg-surface-alt">
      <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        <p className="mt-3 text-lg leading-7 text-ink-muted">{lede}</p>
        <div className="mt-8 space-y-8 rounded-card border border-line bg-white p-6 shadow-card sm:p-8">
          {sections.map((section, i) => (
            <section key={section.heading ?? i}>
              {section.heading ? <h2 className="text-lg">{section.heading}</h2> : null}
              <div className="mt-2 space-y-3 text-sm leading-6 text-ink-muted">
                {section.paragraphs.map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </div>
            </section>
          ))}
          <p className="border-t border-line pt-4 text-xs text-ink-soft">Last updated {updated}</p>
        </div>
      </article>
    </main>
  );
}
