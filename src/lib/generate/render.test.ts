import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FactSheetData, ListItem } from "@/lib/facts/types";
import { ABOUT_V1 } from "@/templates/about-v1";
import { buildJsonLd } from "./jsonld";
import { keyFactsRows } from "./keyfacts";
import {
  JSONLD_COMMENT,
  STYLE_COMMENT,
  escapeHtml,
  jsonLdScript,
  oneLine,
  renderPageHtml,
  renderWordpressHtml,
  safeHref,
} from "./render";
import type { PageDraft, RenderInput } from "./types";

function loadFixture(): FactSheetData {
  const file = path.join(process.cwd(), "examples", "fixtures", "legiit.factsheet.json");
  return JSON.parse(readFileSync(file, "utf8")) as FactSheetData;
}

const INTRO =
  "Legiit is a curated freelance marketplace where business owners and agencies buy SEO, content, design, development, video, and automation work from vetted freelancers, one service at a time.";

function sampleDraft(data: FactSheetData): PageDraft {
  const faqs = (data.fields.existing_faqs?.value ?? []) as ListItem[];
  return {
    metaTitle: "About Legiit | Curated Freelance Marketplace",
    metaDescription: INTRO,
    title: "About Legiit",
    intro: [INTRO, "It launched on February 7, 2018 and has processed over one million orders since."],
    offerings: [
      {
        heading: "The marketplace",
        paragraphs: ["Vetted freelancers sell productized services on Legiit. Orders start at $6."],
        links: [{ label: "The marketplace", url: "https://legiit.com" }],
      },
      { heading: "Command Center", paragraphs: ["Command Center is the business operating system inside Legiit."] },
    ],
    differentiators: [
      {
        heading: "The freelancers are vetted",
        paragraphs: [
          "Legiit vets freelancers before they can sell.",
          "Chris M. Walker, the founder, puts it this way:",
          '> "We don\'t even see them as the same thing."',
        ],
      },
    ],
    customers: ["Business owners priced out of a traditional agency retainer.", "Agencies that need vetted freelancers for client work."],
    founders: [
      {
        heading: "Chris M. Walker, Founder and CEO",
        paragraphs: ["Chris grew up in North Myrtle Beach, South Carolina."],
        links: [
          { label: "YouTube", url: "https://www.youtube.com/@ChrisMWalker" },
          { label: "LinkedIn", url: "https://www.linkedin.com/in/superstarseo/" },
        ],
      },
      {
        heading: "Jim Sabellico, Co-founder and CTO",
        paragraphs: ["Jim co-founded Legiit with Chris."],
        links: [{ label: "Jim Sabellico on LinkedIn", url: "https://www.linkedin.com/in/jimsabellico/" }],
      },
    ],
    originStory: ["When the marketplace Chris depended on became unreliable, he built his own. Legiit launched on February 7, 2018."],
    team: [{ heading: "Jessica Lavatai, COO", paragraphs: ["Jessica runs sales, community, and the customer success organization."] }],
    teamSummary: ["Legiit is 45 people across six continents."],
    process: ["For buyers: create an account and search by service or category.", "For freelancers: apply to sell."],
    faq: faqs.map((f) => ({ question: f.question ?? "", answer: f.answer ?? "" })),
    closing: ["Legiit is for business owners who want the work done.", "Think Big."],
    stillToFill: [],
  };
}

function inputFor(data: FactSheetData, draft = sampleDraft(data), extra: Partial<RenderInput> = {}): RenderInput {
  const siteUrl = "https://legiit.com";
  const pageUrl = "https://legiit.com/about";
  return {
    draft,
    keyFacts: keyFactsRows(ABOUT_V1, data),
    jsonld: buildJsonLd({ spec: ABOUT_V1, data, draft, siteUrl, pageUrl }),
    companyName: "Legiit",
    pageUrl,
    siteUrl,
    ...extra,
  };
}

/** Each needle's position in the text, which must be found, in the order given. */
function positions(text: string, needles: string[]): number[] {
  return needles.map((n) => {
    const at = text.indexOf(n);
    expect(at, `missing: ${n}`).toBeGreaterThanOrEqual(0);
    return at;
  });
}

function expectInOrder(text: string, needles: string[]): void {
  const found = positions(text, needles);
  for (let i = 1; i < found.length; i++) {
    expect(found[i], `"${needles[i]}" should come after "${needles[i - 1]}"`).toBeGreaterThan(found[i - 1]);
  }
}

/** The JSON-LD object inside the first script block. */
function scriptJson(html: string): unknown {
  const open = '<script type="application/ld+json">\n';
  const start = html.indexOf(open) + open.length;
  const end = html.indexOf("\n</script>", start);
  return JSON.parse(html.slice(start, end));
}

/** The text between a section's H2 and its closing tag. */
function sectionOf(html: string, heading: string): string {
  const start = html.indexOf(`<h2>${heading}</h2>`);
  expect(start, `no section "${heading}"`).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf("</section>", start));
}

describe("renderPageHtml", () => {
  const data = loadFixture();
  const input = inputFor(data);
  const page = renderPageHtml(input);

  it("is a standalone document in the example's order", () => {
    expect(page.startsWith("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n")).toBe(true);
    expectInOrder(page, [
      '<meta charset="utf-8">',
      "<title>About Legiit | Curated Freelance Marketplace</title>",
      `<meta name="description" content="${INTRO}">`,
      '<link rel="canonical" href="https://legiit.com/about">',
      `<!-- ${JSONLD_COMMENT} -->`,
      '<script type="application/ld+json">',
      "</script>",
      `<!-- ${STYLE_COMMENT} -->`,
      "<style>",
      "</style>",
      "</head>",
      "<body>",
      "<main>",
      "<article>",
      "<h1>About Legiit</h1>",
      "</article>",
      "</main>",
      "</body>",
      "</html>",
    ]);
    expect(page.endsWith("</html>\n")).toBe(true);
  });

  it("has the comment lines word for word", () => {
    expect(page).toContain(
      "<!-- Structured data. Organization + FAQPage, built only from facts on this page. Delete this block if you do not want it. -->",
    );
    expect(page).toContain("<!-- Preview styling only. Drop this block and use the site's styles. -->");
  });

  it("has every heading in order, with the company name filled in", () => {
    expectInOrder(page, [
      "<h1>About Legiit</h1>",
      "<h2>What Legiit does</h2>",
      "<h3>The marketplace</h3>",
      "<h3>Command Center</h3>",
      "<h2>What makes Legiit different</h2>",
      "<h3>The freelancers are vetted</h3>",
      "<h2>Who uses Legiit</h2>",
      "<h2>The team behind Legiit</h2>",
      "<h3>Chris M. Walker, Founder and CEO</h3>",
      "<h3>Jim Sabellico, Co-founder and CTO</h3>",
      "<h3>How Legiit started</h3>",
      "<h3>Jessica Lavatai, COO</h3>",
      "<h3>The team</h3>",
      "<h2>How Legiit works</h2>",
      "<h2>Key facts</h2>",
      "<h2>Frequently asked questions</h2>",
      "<h3>Is Legiit the same thing as Fiverr or Upwork?</h3>",
      "<h3>Who is behind Legiit?</h3>",
      "<p>Think Big.</p>",
    ]);
    expect(page.match(/<section>/g)?.length).toBe(7);
    expect(page.match(/<\/section>/g)?.length).toBe(7);
  });

  it("puts the intro paragraphs between the H1 and the first section", () => {
    const intro = page.slice(page.indexOf("<h1>"), page.indexOf("<section>"));
    expect(intro).toContain(`<p>${INTRO}</p>`);
    expect(intro).toContain("<p>It launched on February 7, 2018 and has processed over one million orders since.</p>");
  });

  it("renders a quote paragraph as a blockquote", () => {
    expect(sectionOf(page, "What makes Legiit different")).toContain(
      "<p>Chris M. Walker, the founder, puts it this way:</p>\n<blockquote>\n<p>&quot;We don't even see them as the same thing.&quot;</p>\n</blockquote>",
    );
  });

  it("renders an item's links as one line of anchors separated by commas", () => {
    const team = sectionOf(page, "The team behind Legiit");
    expect(team).toContain(
      '<p>Chris grew up in North Myrtle Beach, South Carolina.</p>\n<p><a href="https://www.youtube.com/@ChrisMWalker">YouTube</a>, <a href="https://www.linkedin.com/in/superstarseo/">LinkedIn</a></p>',
    );
    expect(sectionOf(page, "What Legiit does")).toContain('<p><a href="https://legiit.com">The marketplace</a></p>');
  });

  it("renders the customers as a list", () => {
    expect(sectionOf(page, "Who uses Legiit")).toContain(
      "<ul>\n<li>Business owners priced out of a traditional agency retainer.</li>\n<li>Agencies that need vetted freelancers for client work.</li>\n</ul>",
    );
  });

  it("renders the key facts table with row headers", () => {
    const facts = sectionOf(page, "Key facts");
    expect(facts).toContain("<table>\n<tbody>\n<tr>");
    expect(facts).toContain('<tr><th scope="row">Company Name</th><td>Legiit</td></tr>');
    expect(facts).toContain('<tr><th scope="row">Founded</th><td>February 7, 2018</td></tr>');
    expect(facts).toContain('<tr><th scope="row">Website</th><td><a href="https://legiit.com">legiit.com</a></td></tr>');
    expect(facts).toContain(
      '<tr><th scope="row">Founder</th><td>Chris M. Walker, Founder and CEO; Jim Sabellico, Co-founder and CTO</td></tr>',
    );
    expect(facts.match(/<tr>/g)?.length).toBe(input.keyFacts.length);
  });

  it("renders the FAQ as H3 and P pairs", () => {
    const faq = sectionOf(page, "Frequently asked questions");
    expect(faq).toContain(
      "<h3>Is Legiit the same thing as Fiverr or Upwork?</h3>\n<p>No. Fiverr and Upwork are horizontal marketplaces built for volume.",
    );
    expect(faq.match(/<h3>/g)?.length).toBe(input.draft.faq.length);
    expect(faq.match(/<p>/g)?.length).toBe(input.draft.faq.length);
  });

  it("embeds the JSON-LD as given", () => {
    expect(scriptJson(page)).toEqual(input.jsonld);
  });

  it("ends with the closing lines", () => {
    const tail = page.slice(page.lastIndexOf("</section>"));
    expect(tail).toContain("<p>Legiit is for business owners who want the work done.</p>\n\n<p>Think Big.</p>");
  });
});

describe("renderPageHtml escaping", () => {
  const data = loadFixture();

  it("escapes everything from the draft", () => {
    const draft: PageDraft = {
      ...sampleDraft(data),
      metaTitle: 'Smith & Sons <b>bold</b> "quoted"',
      metaDescription: 'A & B <i>c</i> "d"',
      title: "About Smith & Sons <Ltd>",
      intro: ["Smith & Sons <b>bold</b> is a firm."],
      customers: ["People who like <script>alert(1)</script>"],
      founders: [{ heading: "A <b>B</b>", paragraphs: ["> Quote with <em>tags</em>"], links: [{ label: "Site <x>", url: 'https://a.com/?q="1"&r=2' }] }],
      faq: [{ question: "What about <tags> & ampersands?", answer: 'They are "escaped".' }],
      closing: ["Bye <b>"],
    };
    const page = renderPageHtml(inputFor(data, draft, { companyName: "Smith & Sons" }));
    expect(page).toContain("<title>Smith &amp; Sons &lt;b&gt;bold&lt;/b&gt; &quot;quoted&quot;</title>");
    expect(page).toContain('<meta name="description" content="A &amp; B &lt;i&gt;c&lt;/i&gt; &quot;d&quot;">');
    expect(page).toContain("<h1>About Smith &amp; Sons &lt;Ltd&gt;</h1>");
    expect(page).toContain("<p>Smith &amp; Sons &lt;b&gt;bold&lt;/b&gt; is a firm.</p>");
    expect(page).toContain("<li>People who like &lt;script&gt;alert(1)&lt;/script&gt;</li>");
    expect(page).toContain("<h3>A &lt;b&gt;B&lt;/b&gt;</h3>\n<blockquote>\n<p>Quote with &lt;em&gt;tags&lt;/em&gt;</p>\n</blockquote>");
    expect(page).toContain('<p><a href="https://a.com/?q=&quot;1&quot;&amp;r=2">Site &lt;x&gt;</a></p>');
    expect(page).toContain("<h3>What about &lt;tags&gt; &amp; ampersands?</h3>\n<p>They are &quot;escaped&quot;.</p>");
    expect(page).toContain("<h2>What Smith &amp; Sons does</h2>");
    expect(page).not.toContain("<b>bold</b>");
    expect(page).not.toContain("<script>alert");
  });

  it("drops a link whose address is not safe and keeps the rest", () => {
    const draft: PageDraft = {
      ...sampleDraft(data),
      offerings: [
        {
          heading: "Thing",
          paragraphs: ["A thing."],
          links: [
            { label: "Bad", url: "javascript:alert(1)" },
            { label: "Good", url: "legiit.com/thing" },
            { label: "", url: "https://legiit.com/other" },
          ],
        },
      ],
    };
    const page = renderPageHtml(inputFor(data, draft));
    expect(page).toContain('<p><a href="https://legiit.com/thing">Good</a>, <a href="https://legiit.com/other">legiit.com/other</a></p>');
    expect(page).not.toContain("javascript:");
  });

  it("keeps a value in the JSON-LD from closing the script", () => {
    const jsonld = {
      "@context": "https://schema.org",
      "@graph": [{ "@type": "Organization", name: "Evil </script><script>alert(1)</script> <!-- x --> Co" }],
    };
    const page = renderPageHtml(inputFor(data, sampleDraft(data), { jsonld }));
    // one closing tag in the whole page: the script's own
    expect(page.match(/<\/script>/g)?.length).toBe(1);
    expect(page).not.toContain("alert(1)</script>");
    expect(page).toContain("<\\/script>");
    expect(page).toContain("<\\u0021-- x -->");
    expect(scriptJson(page)).toEqual(jsonld);
  });

  it("leaves out the canonical link and meta description when there is nothing safe to put in them", () => {
    const draft = { ...sampleDraft(data), metaDescription: "  " };
    const page = renderPageHtml(inputFor(data, draft, { pageUrl: "javascript:alert(1)" }));
    expect(page).not.toContain('<link rel="canonical"');
    expect(page).not.toContain('<meta name="description"');
  });
});

describe("renderPageHtml sections and comments", () => {
  const data = loadFixture();

  it("leaves out a section with no content", () => {
    const draft: PageDraft = { ...sampleDraft(data), offerings: [], customers: [], faq: [] };
    const page = renderPageHtml(inputFor(data, draft, { keyFacts: [] }));
    expect(page).not.toContain("What Legiit does");
    expect(page).not.toContain("Who uses Legiit");
    expect(page).not.toContain("Frequently asked questions");
    expect(page).not.toContain("Key facts");
    expect(page).toContain("<h2>What makes Legiit different</h2>");
    expect(page).toContain("<h2>The team behind Legiit</h2>");
  });

  it("leaves out an H3 block with nothing under it and the team section when it is all empty", () => {
    const draft: PageDraft = {
      ...sampleDraft(data),
      founders: [{ heading: "   ", paragraphs: ["", "  "] }],
      originStory: [],
      team: [],
      teamSummary: [],
    };
    const page = renderPageHtml(inputFor(data, draft));
    expect(page).not.toContain("The team behind Legiit");
    expect(page).not.toContain("<h3>The team</h3>");
    expect(page).not.toContain("How Legiit started");
  });

  it("uses the template headings with the company name, or 'the business' without one", () => {
    const acme = renderPageHtml(inputFor(data, sampleDraft(data), { companyName: "Acme" }));
    expect(acme).toContain("<h2>What Acme does</h2>");
    expect(acme).toContain("<h2>Who uses Acme</h2>");
    expect(acme).toContain("<h3>How Acme started</h3>");
    const nameless = renderPageHtml(inputFor(data, { ...sampleDraft(data), title: "" }, { companyName: "" }));
    expect(nameless).toContain("<h1>About the business</h1>");
    expect(nameless).toContain("<h2>How the business works</h2>");
  });

  it("falls back to the title, then the company, for an empty meta title", () => {
    expect(renderPageHtml(inputFor(data, { ...sampleDraft(data), metaTitle: "" }))).toContain("<title>About Legiit</title>");
    expect(renderPageHtml(inputFor(data, { ...sampleDraft(data), metaTitle: "", title: "" }))).toContain("<title>About Legiit</title>");
  });

  it("puts the still-to-fill comments in the section each field belongs to", () => {
    const questions = {
      founded_date: "What year did Legiit start?",
      contract_terms: "Do customers sign a contract?",
      origin_story: "How did Legiit start?",
      onboarding: "What happens from first contact to the first delivery?",
      who_you_work_with: "Who does a customer work with day to day?",
      customer_segments: "Who exactly uses Legiit?",
    };
    const draft = { ...sampleDraft(data), stillToFill: Object.keys(questions) };
    const page = renderPageHtml(inputFor(data, draft, { questions }));

    const intro = page.slice(page.indexOf("<h1>"), page.indexOf("<section>"));
    expect(intro).toContain("<!-- Still to fill: What year did Legiit start? -->");
    expect(sectionOf(page, "What Legiit does")).toContain("<!-- Still to fill: Do customers sign a contract? -->");
    expect(sectionOf(page, "The team behind Legiit")).toContain("<!-- Still to fill: How did Legiit start? -->");
    // two in one section, in the template's field order
    expect(sectionOf(page, "How Legiit works")).toContain(
      "<!-- Still to fill: Who does a customer work with day to day? -->\n<!-- Still to fill: What happens from first contact to the first delivery? -->",
    );
    // a field with no section on the page goes at the end, after the closing lines
    const tail = page.slice(page.indexOf("<p>Think Big.</p>"));
    expect(tail).toContain("<!-- Still to fill: Who exactly uses Legiit? -->");
    expect(page.match(/<!-- Still to fill:/g)?.length).toBe(6);
  });

  it("puts a comment at the end when its section is not on the page", () => {
    const questions = { contract_terms: "Do customers sign a contract?" };
    const draft = { ...sampleDraft(data), offerings: [], stillToFill: ["contract_terms"] };
    const page = renderPageHtml(inputFor(data, draft, { questions }));
    const tail = page.slice(page.indexOf("<p>Think Big.</p>"));
    expect(tail).toContain("<!-- Still to fill: Do customers sign a contract? -->");
  });

  it("comments only the fields that have a question, and every field that has one", () => {
    const draft = { ...sampleDraft(data), stillToFill: ["contract_terms", "founded_date"] };
    const page = renderPageHtml(inputFor(data, draft, { questions: { contract_terms: "Do customers sign a contract?", onboarding: "What happens first?" } }));
    expect(page).toContain("<!-- Still to fill: Do customers sign a contract? -->");
    expect(page).toContain("<!-- Still to fill: What happens first? -->");
    expect(page.match(/<!-- Still to fill:/g)?.length).toBe(2);
    const none = renderPageHtml(inputFor(data, draft));
    expect(none).not.toContain("Still to fill");
  });

  it("keeps a question from ending the comment early", () => {
    const draft = { ...sampleDraft(data), stillToFill: ["onboarding"] };
    const page = renderPageHtml(inputFor(data, draft, { questions: { onboarding: "Why -- really --> <!-- now?" } }));
    expect(page).toContain("<!-- Still to fill: Why - really -> <! now? -->");
    expect(page).not.toContain("-->?");
  });
});

describe("renderWordpressHtml", () => {
  const data = loadFixture();
  const input = inputFor(data);
  const page = renderPageHtml(input);
  const wp = renderWordpressHtml(input);

  it("is the article's inner HTML with the JSON-LD script first", () => {
    expect(wp.startsWith(`<!-- ${JSONLD_COMMENT} -->\n<script type="application/ld+json">\n`)).toBe(true);
    const marker = "</script>\n\n";
    const body = wp.slice(wp.indexOf(marker) + marker.length);
    const inner = page.slice(page.indexOf("<article>\n\n") + "<article>\n\n".length, page.indexOf("\n\n</article>"));
    expect(body).toBe(`${inner}\n`);
    expect(scriptJson(wp)).toEqual(input.jsonld);
  });

  it("has no document wrapper", () => {
    for (const tag of ["<!DOCTYPE", "<html", "<head", "<title", "<style", "<body", "<main", "<article", "</article>"]) {
      expect(wp, tag).not.toContain(tag);
    }
    expect(wp).toContain("<h1>About Legiit</h1>");
    expect(wp).toContain("<h2>Key facts</h2>");
    expect(wp).toContain('<tr><th scope="row">Company Name</th><td>Legiit</td></tr>');
  });
});

describe("helpers", () => {
  it("escapeHtml escapes the four characters that matter in text and double-quoted attributes", () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
    expect(escapeHtml("plain")).toBe("plain");
  });

  it("oneLine collapses whitespace", () => {
    expect(oneLine("  a \n\t b  ")).toBe("a b");
    expect(oneLine(undefined)).toBe("");
    expect(oneLine(null)).toBe("");
  });

  it("safeHref allows http(s), mailto, and tel, adds https to a bare host, and refuses the rest", () => {
    expect(safeHref("https://legiit.com/about")).toBe("https://legiit.com/about");
    expect(safeHref("http://legiit.com")).toBe("http://legiit.com");
    expect(safeHref(" legiit.com ")).toBe("https://legiit.com");
    expect(safeHref("mailto:info@legiit.com")).toBe("mailto:info@legiit.com");
    expect(safeHref("tel:+1 604 533 9163")).toBe("tel:+1 604 533 9163");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("not a url")).toBeNull();
    expect(safeHref("")).toBeNull();
    expect(safeHref("localhost")).toBeNull();
  });

  it("jsonLdScript wraps the JSON and escapes what could close the script", () => {
    const script = jsonLdScript({ a: "</script>", b: "<!-- c -->" });
    expect(script.startsWith('<script type="application/ld+json">\n{')).toBe(true);
    expect(script.endsWith("\n</script>")).toBe(true);
    expect(script).toContain('"a": "<\\/script>"');
    expect(script).toContain('"b": "<\\u0021-- c -->"');
    expect(JSON.parse(script.slice(script.indexOf("{"), script.lastIndexOf("}") + 1))).toEqual({ a: "</script>", b: "<!-- c -->" });
  });
});
