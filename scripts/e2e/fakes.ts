/*
  The outside world for the local end-to-end run: a small business site and a
  stand-in for the Anthropic Messages API.

  The site is Acme Roofing, made up for the test. Its facts are known, so the
  fact sheet can be checked: two different phone numbers (a conflict), an
  email, an address, three services, an owner and a project manager, and
  nothing about a mission or contracts (missing fields). robots.txt
  disallows /private/, which the home page links to.

  The model stand-in reads the page text out of the prompt and answers with
  findings it finds by pattern, each quoting the page verbatim, plus one
  finding whose quote is not on the page, which verification must drop. It
  fails every call for the pricing page, so that page ends as a failed
  extraction that still keeps its links and JSON-LD.
*/
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const SITE_HOST = "acme-roofing.example";
export const SITE_ORIGIN = `https://${SITE_HOST}`;

function page(title: string, body: string, head = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
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

export interface FakeModel extends FakeServer {
  /** Page URLs the model was asked about, in order. */
  pages: string[];
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

type MessagesRequest = { model: string; messages: { role: string; content: string }[] };

export async function startFakeModel(): Promise<FakeModel> {
  const requests: string[] = [];
  const pages: string[] = [];
  let n = 0;
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "Not found" } }));
      return;
    }
    readJson(req)
      .then((raw) => {
        const body = raw as MessagesRequest;
        const user = body.messages.find((m) => m.role === "user")?.content ?? "";
        const url = /^Page URL: (.+)$/m.exec(user)?.[1]?.trim() ?? "";
        const text = /<<<PAGE\n([\s\S]*?)\nPAGE>>>/.exec(user)?.[1] ?? "";
        pages.push(url);
        if (new URL(url).pathname.startsWith("/pricing")) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "Internal server error" } }));
          return;
        }
        const output = {
          findings: findingsFor(text),
          page_summary: "A page of the Acme Roofing site.",
          business_name_guess: text.includes("Acme Roofing") ? "Acme Roofing" : "",
        };
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
            usage: { input_tokens: 800 + Math.round(user.length / 4), output_tokens: 120 + 40 * output.findings.length },
          }),
        );
      })
      .catch((e: unknown) => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: String(e) } }));
      });
  });
  const base = await listen(server, requests);
  return { ...base, pages };
}
