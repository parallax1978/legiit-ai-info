/*
  The outside world for the local end-to-end run: a small business site and a
  stand-in for the Anthropic Messages API.

  The site is Acme Roofing, made up for the test. Its facts are known, so the
  fact sheet can be checked: two different phone numbers (a conflict), an
  email, an address, three services, an owner and a project manager, and
  nothing about a mission or contracts (missing fields). robots.txt
  disallows /private/, which the home page links to.

  The model stand-in answers two kinds of call, told apart by the structured
  output schema in the request. For the extractor it reads the page text out
  of the prompt and answers with findings it finds by pattern, each quoting
  the page verbatim, plus one finding whose quote is not on the page, which
  verification must drop. It fails every call for the pricing page, so that
  page ends as a failed extraction that still keeps its links and JSON-LD.
  For the page writer it answers with a draft built from the site's facts:
  every main draft carries one banned word, so the lint and rewrite path runs
  once, and the rewrite answer is the draft from the prompt with that word
  taken out.

  The pages carry WordPress markers (the generator tag and a wp-content path)
  so the scan detects a platform the install instructions can name.
*/
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { DraftFaqOutput, DraftFullOutput, DraftMainOutput } from "@/lib/generate/schema";

export const SITE_HOST = "acme-roofing.example";
export const SITE_ORIGIN = `https://${SITE_HOST}`;

function page(title: string, body: string, head = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="WordPress 6.6">
<link rel="stylesheet" href="/wp-content/themes/acme/style.css">
<title>${title}</title>
${head}
</head>
<body>
<header>
  <a href="/"><img src="/logo.png" alt="Acme Roofing logo"></a>
  <nav>
    <a href="/">Home</a>
    <a href="/about">About us</a>
    <a href="/services/">Services</a>
    <a href="/pricing/">Pricing</a>
    <a href="/contact/">Contact</a>
    <a href="/brochure.pdf">Brochure</a>
    <a href="/private/notes/">Staff notes</a>
  </nav>
</header>
<main>
${body}
</main>
<footer>
  <a href="https://www.facebook.com/acmeroofingdayton">Facebook</a>
  <a href="mailto:info@acme-roofing.example">info@acme-roofing.example</a>
</footer>
</body>
</html>`;
}

const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "RoofingContractor",
  name: "Acme Roofing",
  telephone: "+1-937-555-0142",
  url: `${SITE_ORIGIN}/`,
  address: {
    "@type": "PostalAddress",
    streetAddress: "1200 Main Street",
    addressLocality: "Dayton",
    addressRegion: "OH",
    postalCode: "45402",
    addressCountry: "US",
  },
});

const PAGES: Record<string, string> = {
  "/": page(
    "Acme Roofing | Roofers in Dayton, Ohio",
    `<h1>Roof replacement and repair in Dayton</h1>
<p>Acme Roofing is a family-run roofing company in Dayton, Ohio. Founded in 1998, we have replaced more than 4,000 roofs across the Miami Valley.</p>
<p>Call (937) 555-0142 for a free inspection.</p>`,
    `<meta name="description" content="Family-run roofers in Dayton, Ohio since 1998.">
<link rel="canonical" href="${SITE_ORIGIN}/">
<script type="application/ld+json">${JSON_LD}</script>`,
  ),
  "/about-us/": page(
    "About Acme Roofing",
    `<h1>About Acme Roofing</h1>
<p>Maria Lopez founded Acme Roofing in 1998 after twenty years on other people's crews.</p>
<h2>Our team</h2>
<ul><li>Maria Lopez, Owner</li><li>Sam Patel, Project Manager</li></ul>`,
  ),
  "/services/": page(
    "Roofing services",
    `<h1>Our services</h1>
<ul>
<li>Roof replacement: full tear-off and new architectural shingles.</li>
<li>Roof repair: leaks, flashing, and storm damage.</li>
<li>Gutter installation: seamless aluminum gutters.</li>
</ul>`,
  ),
  "/pricing/": page(
    "Pricing",
    `<h1>Pricing</h1>
<p>Roof inspections are free. Repairs start at $350, and every job gets a written quote before work begins.</p>`,
  ),
  "/contact/": page(
    "Contact Acme Roofing",
    `<h1>Contact us</h1>
<p>Call us at (937) 555-0199 or email info@acme-roofing.example.</p>
<p>Visit us at 1200 Main Street, Dayton, OH 45402.</p>`,
  ),
  "/private/notes/": page("Staff notes", "<p>Not for crawlers.</p>"),
};

const ROBOTS = `User-agent: *
Disallow: /private/
Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["/", "/about-us/", "/services/", "/pricing/", "/contact/"].map((p) => `  <url><loc>${SITE_ORIGIN}${p}</loc></url>`).join("\n")}
</urlset>`;

export interface FakeServer {
  url: string;
  /** Every request as "METHOD /path". */
  requests: string[];
  close(): Promise<void>;
}

async function listen(server: Server, requests: string[]): Promise<FakeServer> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function startFakeSite(): Promise<FakeServer> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", SITE_ORIGIN).pathname;
    requests.push(`${req.method} ${path}`);
    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(ROBOTS);
    } else if (path === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(SITEMAP);
    } else if (path === "/about" || path === "/about/") {
      // An old address in the menu that now redirects, as WordPress keeps old slugs.
      res.writeHead(301, { location: `${SITE_ORIGIN}/about-us/` });
      res.end();
    } else if (PAGES[`${path}/`]) {
      // WordPress answers a page address without its trailing slash with a redirect to it.
      res.writeHead(301, { location: `${SITE_ORIGIN}${path}/` });
      res.end();
    } else if (PAGES[path]) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGES[path]);
    } else {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<h1>Not found</h1>");
    }
  });
  return listen(server, requests);
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

type Pair = { key: string; value: string };
type Finding = {
  field_id: string;
  kind: "scalar" | "list_item" | "address";
  value: string;
  item: Pair[];
  quote: string;
  confidence: number;
  note: string;
};

function scalar(field_id: string, value: string, quote: string): Finding {
  return { field_id, kind: "scalar", value, item: [], quote, confidence: 0.9, note: "" };
}

function listItem(field_id: string, item: Record<string, string>, quote: string): Finding {
  return {
    field_id,
    kind: "list_item",
    value: "",
    item: Object.entries(item).map(([key, value]) => ({ key, value })),
    quote,
    confidence: 0.9,
    note: "",
  };
}

/** The sentence or line of `text` that holds `needle`. */
function around(text: string, needle: string): string {
  const line = text.split("\n").find((l) => l.includes(needle)) ?? needle;
  const clean = line.replace(/^[-#*\s]+/, "").trim();
  const sentence = clean.split(/(?<=[.!?])\s+/).find((s) => s.includes(needle));
  return sentence ?? clean;
}

/** Findings for one page's text, by pattern. */
export function findingsFor(text: string): Finding[] {
  const out: Finding[] = [];
  if (text.includes("Acme Roofing is a family-run roofing company")) {
    out.push(scalar("company_name", "Acme Roofing", around(text, "Acme Roofing is a family-run roofing company")));
  }
  for (const m of text.matchAll(/\(\d{3}\) \d{3}-\d{4}/g)) out.push(scalar("phone", m[0], around(text, m[0])));
  if (text.includes("email info@acme-roofing.example")) {
    out.push(scalar("email", "info@acme-roofing.example", around(text, "email info@acme-roofing.example")));
  }
  if (text.includes("1200 Main Street, Dayton, OH 45402")) {
    out.push({
      field_id: "headquarters",
      kind: "address",
      value: "1200 Main Street, Dayton, OH 45402",
      item: [
        { key: "streetAddress", value: "1200 Main Street" },
        { key: "addressLocality", value: "Dayton" },
        { key: "addressRegion", value: "OH" },
        { key: "postalCode", value: "45402" },
      ],
      quote: around(text, "1200 Main Street, Dayton, OH 45402"),
      confidence: 0.9,
      note: "",
    });
  }
  for (const m of text.matchAll(/^[-*\s]*(Roof replacement|Roof repair|Gutter installation): (.+?)$/gm)) {
    out.push(listItem("services", { name: m[1], description: m[2].replace(/\.$/, "") }, `${m[1]}: ${m[2]}`));
  }
  if (text.includes("Maria Lopez, Owner")) {
    out.push(listItem("founders", { name: "Maria Lopez", title: "Owner" }, "Maria Lopez, Owner"));
  }
  if (text.includes("Sam Patel, Project Manager")) {
    out.push(listItem("team_members", { name: "Sam Patel", role: "Project Manager" }, "Sam Patel, Project Manager"));
  }
  if (out.length) {
    // Not on any page: verification must drop it.
    out.push(scalar("mission", "To be the best roofer in Ohio", "We aim to be the best roofer in Ohio."));
  }
  return out;
}


// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

/**
 * The banned word every main draft carries, so the lint fails once and the
 * rewrite call runs. The rewrite answer takes it out.
 */
export const BANNED_IN_DRAFT = "world-class";

/**
 * The draft is written from the facts the scan finds on the site, after the
 * owner has picked the main phone number on the review screen: the company
 * name, the three services, the owner and the project manager, the address,
 * and that one number. Every digit in it is in the fact sheet's values or
 * quotes, which is what the linter checks; the founding year is not, because
 * no finding quotes the sentence that states it, so the draft leaves it out
 * the way a writer that uses only the fact sheet would.
 */
const MAIN_DRAFT: Omit<DraftMainOutput, "stillToFill"> = {
  metaTitle: "About Acme Roofing | Roofers in Dayton, Ohio",
  metaDescription: "Acme Roofing is a family-run roofing company in Dayton, Ohio that replaces and repairs roofs and installs gutters.",
  title: "About Acme Roofing",
  intro: [
    "Acme Roofing is a family-run roofing company in Dayton, Ohio. It replaces roofs, repairs leaks and storm damage, and installs gutters for homeowners in the area.",
    "Maria Lopez owns the company and Sam Patel manages each project.",
  ],
  offerings: [
    {
      heading: "Roof replacement",
      paragraphs: ["A roof replacement is a full tear-off followed by new architectural shingles. Every job gets a written quote before work begins."],
      links: [],
    },
    {
      heading: "Roof repair",
      paragraphs: ["Roof repair covers leaks, flashing, and storm damage. Acme Roofing offers repairs on every roof type."],
      links: [],
    },
    {
      heading: "Gutter installation",
      paragraphs: ["Acme Roofing installs aluminum gutters made without seams."],
      links: [],
    },
  ],
  differentiators: [
    {
      heading: "Family-run since the start",
      paragraphs: ["Maria Lopez founded the company and still runs it, so the owner is on the job."],
      links: [],
    },
    {
      heading: "One contact for the whole job",
      paragraphs: ["Sam Patel, the project manager, is the customer's contact from the first inspection to the final walk-through."],
      links: [],
    },
    {
      heading: "A written quote before work begins",
      paragraphs: ["Every job gets a written quote before work begins, so the price is known in advance."],
      links: [],
    },
  ],
  customers: ["Homeowners in Dayton, Ohio", "Property owners with storm damage"],
  founders: [
    {
      heading: "Maria Lopez, Owner",
      paragraphs: ["Maria Lopez founded Acme Roofing after years on other roofing crews. She still runs the company."],
      links: [],
    },
  ],
  originStory: [],
  team: [
    {
      heading: "Sam Patel, Project Manager",
      paragraphs: ["Sam Patel manages each project and is the customer's day-to-day contact."],
      links: [],
    },
  ],
  teamSummary: [],
  process: [
    "Call (937) 555-0142 for a free inspection. Sam Patel then schedules the work and stays the customer's contact until the job is done.",
  ],
};

const FAQ_DRAFT: DraftFaqOutput = {
  faq: [
    {
      question: "What does Acme Roofing do?",
      answer: "Acme Roofing replaces roofs, repairs leaks and storm damage, and installs gutters. It is a family-run roofing company in Dayton, Ohio.",
    },
    {
      question: "Where is Acme Roofing based?",
      answer: "Acme Roofing is at 1200 Main Street, Dayton, OH 45402. The crews work on homes across Dayton.",
    },
    {
      question: "Who owns Acme Roofing?",
      answer: "Maria Lopez owns Acme Roofing. She founded the company after years on other roofing crews and still runs it.",
    },
    {
      question: "Who runs the job once work starts?",
      answer: "Sam Patel, the project manager, runs each job. He is the customer's contact from the first inspection to the last day on site.",
    },
    {
      question: "Does Acme Roofing replace whole roofs?",
      answer: "Yes. A roof replacement is a full tear-off followed by new architectural shingles.",
    },
    {
      question: "Can Acme Roofing repair a leak?",
      answer: "Yes. Roof repair covers leaks, flashing, and storm damage.",
    },
    {
      question: "Does Acme Roofing install gutters?",
      answer: "Yes. Acme Roofing installs aluminum gutters made without seams.",
    },
    {
      question: "How do I reach Acme Roofing?",
      answer: "Call (937) 555-0142. You can also email info@acme-roofing.example.",
    },
    {
      question: "Does Acme Roofing give a quote before work starts?",
      answer: "Yes. Every job gets a written quote before work begins.",
    },
    {
      question: "Is the first inspection free?",
      answer: "Yes. Acme Roofing offers a free roof inspection, and the number to book one is (937) 555-0142.",
    },
  ],
  closing: ["Call Acme Roofing at (937) 555-0142 for a free inspection."],
};

/** The FAQ questions the page must show, for the end-to-end assertions. */
export const FAQ_QUESTIONS: readonly string[] = FAQ_DRAFT.faq.map((f) => f.question);

/** The ids the request lists on its "stillToFill:" line, copied exactly, as the system prompt asks. */
function stillToFillFrom(user: string): string[] {
  const line = /^stillToFill: (.+)$/m.exec(user)?.[1]?.trim() ?? "";
  if (!line || line.startsWith("none")) return [];
  return line.split(",").map((id) => id.trim()).filter(Boolean);
}

/** The main draft for a request, with the banned word in the second offering. */
function mainDraft(user: string): DraftMainOutput {
  const offerings = MAIN_DRAFT.offerings.map((o, i) =>
    i === 1
      ? { ...o, paragraphs: [`Roof repair covers leaks, flashing, and storm damage. Acme Roofing offers ${BANNED_IN_DRAFT} repairs on every roof type.`] }
      : o,
  );
  return { ...MAIN_DRAFT, offerings, stillToFill: stillToFillFrom(user) };
}

/** The draft the rewrite prompt carries, between its marker line and the fact sheet block. */
function draftInPrompt(user: string): DraftFullOutput {
  const marker = "The draft, as JSON in the shape to return:\n";
  const start = user.indexOf(marker);
  if (start < 0) throw new Error("rewrite prompt: no draft block");
  const from = start + marker.length;
  const end = user.indexOf("\nFact sheet:", from);
  return JSON.parse(user.slice(from, end < 0 ? undefined : end).trim()) as DraftFullOutput;
}

/** The value with the banned word taken out of every string, everything else untouched. */
function withoutBannedWord<T>(value: T): T {
  if (typeof value === "string") return value.replace(new RegExp(`\\b${BANNED_IN_DRAFT} `, "gi"), "") as T;
  if (Array.isArray(value)) return value.map(withoutBannedWord) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, withoutBannedWord(v)])) as T;
  }
  return value;
}

export type WriterCall = "main" | "faq" | "rewrite";

/** Which writer call a request is, from the property names of its output schema; null for the extractor. */
function writerCallOf(properties: readonly string[]): WriterCall | null {
  const has = (name: string) => properties.includes(name);
  if (has("findings")) return null;
  if (has("offerings") && has("faq")) return "rewrite";
  if (has("offerings")) return "main";
  if (has("faq")) return "faq";
  return null;
}

function writerAnswer(call: WriterCall, user: string): DraftMainOutput | DraftFaqOutput | DraftFullOutput {
  switch (call) {
    case "main":
      return mainDraft(user);
    case "faq":
      return FAQ_DRAFT;
    case "rewrite":
      return withoutBannedWord(draftInPrompt(user));
  }
}

// ---------------------------------------------------------------------------
// The Messages API
// ---------------------------------------------------------------------------

export interface FakeModel extends FakeServer {
  /** Page URLs the extractor was asked about, in order. */
  pages: string[];
  /** The writer calls answered, in order. */
  writes: WriterCall[];
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

type MessagesRequest = {
  model: string;
  messages: { role: string; content: string }[];
  output_config?: { format?: { schema?: { properties?: Record<string, unknown> } } };
};

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

function apiError(status: number, type: string, message: string): [number, string] {
  return [status, JSON.stringify({ type: "error", error: { type, message } })];
}

export async function startFakeModel(): Promise<FakeModel> {
  const requests: string[] = [];
  const pages: string[] = [];
  const writes: WriterCall[] = [];
  let n = 0;
  // The writer marks its system prompt for caching: the first call writes the cache, the rest read it.
  let systemCached = false;

  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
      const [status, body] = apiError(404, "not_found_error", "Not found");
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    readJson(req)
      .then((raw) => {
        const body = raw as MessagesRequest;
        const user = body.messages.find((m) => m.role === "user")?.content ?? "";
        const properties = Object.keys(body.output_config?.format?.schema?.properties ?? {});
        const call = writerCallOf(properties);

        let output: unknown;
        let usage: Usage;
        if (call) {
          writes.push(call);
          output = writerAnswer(call, user);
          const system = 1_500;
          usage = {
            input_tokens: 400 + Math.round(user.length / 4),
            output_tokens: Math.round(JSON.stringify(output).length / 4),
            ...(systemCached ? { cache_read_input_tokens: system } : { cache_creation_input_tokens: system }),
          };
          systemCached = true;
        } else {
          if (!properties.includes("findings")) throw new Error(`unknown structured output: ${properties.join(", ")}`);
          const url = /^Page URL: (.+)$/m.exec(user)?.[1]?.trim() ?? "";
          const text = /<<<PAGE\n([\s\S]*?)\nPAGE>>>/.exec(user)?.[1] ?? "";
          pages.push(url);
          if (new URL(url).pathname.startsWith("/pricing")) {
            const [status, error] = apiError(500, "api_error", "Internal server error");
            res.writeHead(status, { "content-type": "application/json" });
            res.end(error);
            return;
          }
          const findings = findingsFor(text);
          output = {
            findings,
            page_summary: "A page of the Acme Roofing site.",
            business_name_guess: text.includes("Acme Roofing") ? "Acme Roofing" : "",
          };
          usage = { input_tokens: 800 + Math.round(user.length / 4), output_tokens: 120 + 40 * findings.length };
        }

        n += 1;
        res.writeHead(200, { "content-type": "application/json", "request-id": `req_e2e_${n}` });
        res.end(
          JSON.stringify({
            id: `msg_e2e_${n}`,
            type: "message",
            role: "assistant",
            model: body.model,
            content: [{ type: "text", text: JSON.stringify(output) }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage,
          }),
        );
      })
      .catch((e: unknown) => {
        const [status, body] = apiError(400, "invalid_request_error", String(e));
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body);
      });
  });
  const base = await listen(server, requests);
  return { ...base, pages, writes };
}
