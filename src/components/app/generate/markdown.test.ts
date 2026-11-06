import { describe, expect, it } from "vitest";
import { isSafeHref, parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("reads code, bold, and links, and leaves unsafe links as text", () => {
    expect(parseInline("Paste `about.html` into the **Custom HTML** block, see [the docs](https://example.com/docs).")).toEqual([
      { type: "text", text: "Paste " },
      { type: "code", text: "about.html" },
      { type: "text", text: " into the " },
      { type: "strong", children: [{ type: "text", text: "Custom HTML" }] },
      { type: "text", text: " block, see " },
      { type: "link", href: "https://example.com/docs", children: [{ type: "text", text: "the docs" }] },
      { type: "text", text: "." },
    ]);
    expect(parseInline("[bad](javascript:alert(1))")).toEqual([{ type: "text", text: "[bad](javascript:alert(1))" }]);
    expect(parseInline("plain")).toEqual([{ type: "text", text: "plain" }]);
    expect(parseInline("")).toEqual([]);
  });

  it("allows web, mail, and same-site links only", () => {
    expect(isSafeHref("https://search.google.com/test/rich-results")).toBe(true);
    expect(isSafeHref("mailto:help@legiit.com")).toBe(true);
    expect(isSafeHref("/account")).toBe(true);
    expect(isSafeHref("//evil.example")).toBe(false);
    expect(isSafeHref("data:text/html,hi")).toBe(false);
  });
});

describe("parseMarkdown", () => {
  it("splits headings, paragraphs, lists, code, and tables", () => {
    const md = [
      "# Installing the page",
      "",
      "What is in the download:",
      "continued on the next line.",
      "",
      "- `about.html`: the page",
      "- `schema.json`: the schema",
      "  pasted into the head",
      "",
      "1. Open Pages",
      "2) Add a Custom HTML block",
      "",
      "```html",
      "<script type=\"application/ld+json\">{}</script>",
      "```",
      "",
      "| File | Where |",
      "|------|-------|",
      "| about.html | the page |",
      "",
      "---",
      "## Check it",
    ].join("\n");

    expect(parseMarkdown(md)).toEqual([
      { type: "heading", level: 1, children: [{ type: "text", text: "Installing the page" }] },
      { type: "paragraph", children: [{ type: "text", text: "What is in the download: continued on the next line." }] },
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "code", text: "about.html" }, { type: "text", text: ": the page" }],
          [{ type: "code", text: "schema.json" }, { type: "text", text: ": the schema pasted into the head" }],
        ],
      },
      {
        type: "list",
        ordered: true,
        items: [[{ type: "text", text: "Open Pages" }], [{ type: "text", text: "Add a Custom HTML block" }]],
      },
      { type: "code", text: "<script type=\"application/ld+json\">{}</script>", lang: "html" },
      {
        type: "table",
        header: [{ type: "text", text: "File" }, { type: "text", text: "Where" }],
        rows: [[[{ type: "text", text: "about.html" }], [{ type: "text", text: "the page" }]]],
      },
      { type: "heading", level: 2, children: [{ type: "text", text: "Check it" }] },
    ]);
  });

  it("keeps an unclosed code fence and Windows line endings", () => {
    expect(parseMarkdown("```\r\nline one\r\nline two")).toEqual([{ type: "code", text: "line one\nline two", lang: null }]);
  });

  it("does not mix bullet and numbered items in one list", () => {
    const blocks = parseMarkdown("- a\n1. b");
    expect(blocks.map((b) => b.type)).toEqual(["list", "list"]);
  });
});
