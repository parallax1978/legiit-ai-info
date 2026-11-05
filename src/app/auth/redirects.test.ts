import { describe, expect, it } from "vitest";
import { nextUrl, safeNext } from "./redirects";

describe("safeNext", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeNext("/app")).toBe("/app");
    expect(safeNext("/app/new?site=example.com")).toBe("/app/new?site=example.com");
    expect(safeNext("/app/projects/123")).toBe("/app/projects/123");
  });

  it("refuses anything that leaves the site", () => {
    for (const value of [
      "https://evil.com/",
      "//evil.com",
      "/\\evil.com",
      "/\\\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r\n/evil.com",
      "\t//evil.com",
      "javascript:alert(1)",
      "app",
      "",
    ]) {
      expect(safeNext(value), JSON.stringify(value)).toBe("/app");
    }
  });

  it("refuses control characters and non-strings", () => {
    expect(safeNext("/app\u0000")).toBe("/app");
    expect(safeNext("/app%0d%0aSet-Cookie:x=y")).toBe("/app%0d%0aSet-Cookie:x=y");
    expect(safeNext(undefined)).toBe("/app");
    expect(safeNext(42)).toBe("/app");
  });

  it("uses the fallback given", () => {
    expect(safeNext("//evil.com", "/login")).toBe("/login");
  });
});

describe("nextUrl", () => {
  it("stays on the origin", () => {
    expect(nextUrl("/app/new?site=a.com", "https://legiitaiinfo.com").href).toBe(
      "https://legiitaiinfo.com/app/new?site=a.com",
    );
    expect(nextUrl("/\t/evil.com", "https://legiitaiinfo.com").href).toBe("https://legiitaiinfo.com/app");
  });
});
