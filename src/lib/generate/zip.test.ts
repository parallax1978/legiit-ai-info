import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildZip, type ZipFile } from "./zip";

const FILES: ZipFile[] = [
  { name: "about.html", data: "<!doctype html>\n<html lang=\"en\"><body><h1>About Legiit</h1><p>Café, naïve, 日本語, ✓</p></body></html>\n" },
  { name: "about-wordpress.html", data: '<script type="application/ld+json">{"@context":"https://schema.org"}</script>\n<article></article>\n' },
  { name: "schema.json", data: `${JSON.stringify({ "@context": "https://schema.org", "@graph": [] }, null, 2)}\n` },
  { name: "instructions.md", data: "# Install the About page for Legiit\n\n1. Open Pages.\n" },
  { name: "fact-sheet.json", data: `${JSON.stringify({ templateId: "about-v1", fields: {} }, null, 2)}\n` },
];

describe("buildZip", () => {
  it("is a zip archive", () => {
    const zip = buildZip(FILES);
    expect(zip.length).toBeGreaterThan(0);
    // Local file header signature: "PK\x03\x04".
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("round-trips every file with its name and its exact text", () => {
    const unzipped = unzipSync(buildZip(FILES));
    expect(Object.keys(unzipped).sort()).toEqual(FILES.map((f) => f.name).sort());
    for (const f of FILES) {
      expect(strFromU8(unzipped[f.name])).toBe(f.data);
    }
  });

  it("keeps non-ASCII text intact as UTF-8", () => {
    const text = "Darcy Bailey & Associates Counselling, Langley, BC. Prix: 150 $. Ünïcödé — ✓ 日本語";
    const unzipped = unzipSync(buildZip([{ name: "note.txt", data: text }]));
    expect(strFromU8(unzipped["note.txt"])).toBe(text);
  });

  it("keeps a large file intact", () => {
    const line = "The quick brown fox jumps over the lazy dog. 0123456789\n";
    const data = line.repeat(8000);
    expect(data.length).toBeGreaterThan(400_000);
    const zip = buildZip([{ name: "big.txt", data }]);
    expect(zip.length).toBeLessThan(data.length);
    expect(strFromU8(unzipSync(zip)["big.txt"])).toBe(data);
  });

  it("makes an empty archive for no files", () => {
    const zip = buildZip([]);
    expect(zip.length).toBeGreaterThan(0);
    expect(unzipSync(zip)).toEqual({});
  });

  it("stores an empty file as empty", () => {
    const unzipped = unzipSync(buildZip([{ name: "empty.txt", data: "" }]));
    expect(Object.keys(unzipped)).toEqual(["empty.txt"]);
    expect(unzipped["empty.txt"].length).toBe(0);
  });
});
