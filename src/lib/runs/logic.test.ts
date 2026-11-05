import { describe, expect, it } from "vitest";
import type { PlatformDetection } from "@/lib/crawler/platform";
import type { CrawlPageRow, RunLogEntry } from "@/lib/db/types";
import {
  MAX_LOG_ENTRIES,
  appendLog,
  chunk,
  companyNameFrom,
  discoveryMessage,
  errorText,
  existingSchemaOf,
  extractBatchMessage,
  extractOrder,
  factSheetReadyMessage,
  fetchBatchMessage,
  isHomePage,
  isTerminalStatus,
  lockCutoffIso,
  lockFilter,
  mergeSitePlatform,
  overTextBudget,
  pageKey,
  reusedPageRow,
  takeBatch,
  utf8Bytes,
} from "./logic";

describe("lock", () => {
  it("computes the cutoff as now minus the lease", () => {
    const now = Date.UTC(2026, 10, 5, 9, 0, 45);
    expect(lockCutoffIso(now, 45_000)).toBe("2026-11-05T09:00:00.000Z");
  });

  it("builds the free-or-expired filter with the timestamp quoted", () => {
    expect(lockFilter("2026-11-05T09:00:00.000Z")).toBe('locked_at.is.null,locked_at.lt."2026-11-05T09:00:00.000Z"');
  });

  it("knows which statuses have nothing left to step", () => {
    expect(isTerminalStatus("done")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
  });
});

describe("queue batching", () => {
  const queue = [1, 2, 3, 4, 5, 6, 7];

  it("takes the first entries and leaves the rest in order", () => {
    expect(takeBatch(queue, 6)).toEqual({ batch: [1, 2, 3, 4, 5, 6], rest: [7] });
  });

  it("handles a short queue, an empty queue, and a zero size", () => {
    expect(takeBatch([1, 2], 6)).toEqual({ batch: [1, 2], rest: [] });
    expect(takeBatch([], 6)).toEqual({ batch: [], rest: [] });
    expect(takeBatch(queue, 0)).toEqual({ batch: [], rest: queue });
  });

  it("does not mutate the queue", () => {
    const copy = [...queue];
    takeBatch(queue, 3);
    expect(queue).toEqual(copy);
  });

  it("chunks a list into runs of at most the size", () => {
    expect(chunk(queue, 4)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7],
    ]);
    expect(chunk([], 4)).toEqual([]);
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });

  it("orders the extract queue by rank and keeps only fetched pages", () => {
    const pages: Pick<CrawlPageRow, "id" | "rank" | "status">[] = [
      { id: "c", rank: 2, status: "fetched" },
      { id: "a", rank: 0, status: "fetched" },
      { id: "x", rank: 1, status: "failed" },
      { id: "b", rank: 1, status: "fetched" },
      { id: "s", rank: 3, status: "skipped" },
    ];
    expect(extractOrder(pages)).toEqual(["a", "b", "c"]);
  });
});

describe("text budget", () => {
  it("counts bytes, not characters", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("café")).toBe(5);
    expect(utf8Bytes("")).toBe(0);
  });

  it("allows a page that lands exactly on the budget and refuses one past it", () => {
    const max = 3 * 1024 * 1024;
    expect(overTextBudget(0, 60_000, max)).toBe(false);
    expect(overTextBudget(max - 60_000, 60_000, max)).toBe(false);
    expect(overTextBudget(max - 60_000, 60_001, max)).toBe(true);
    expect(overTextBudget(max, 1, max)).toBe(true);
  });
});

describe("log", () => {
  it("appends an entry with the level, message, and time", () => {
    const log = appendLog([], "info", "Found 12 pages from the sitemap", "2026-11-05T09:00:00.000Z");
    expect(log).toEqual([{ at: "2026-11-05T09:00:00.000Z", level: "info", message: "Found 12 pages from the sitemap" }]);
  });

  it("treats a missing log as empty and keeps the latest entries under the cap", () => {
    let log: RunLogEntry[] = appendLog(null, "info", "first");
    for (let i = 0; i < MAX_LOG_ENTRIES + 10; i++) log = appendLog(log, "info", `entry ${i}`);
    expect(log.length).toBe(MAX_LOG_ENTRIES);
    expect(log[log.length - 1].message).toBe(`entry ${MAX_LOG_ENTRIES + 9}`);
    expect(log[0].message).toBe("entry 10");
  });

  it("writes the messages the progress screen shows", () => {
    expect(discoveryMessage(true, 31)).toBe("Found 31 pages from the sitemap");
    expect(discoveryMessage(true, 1)).toBe("Found 1 page from the sitemap");
    expect(discoveryMessage(false, 1)).toBe("No sitemap, following links from the home page");
    expect(fetchBatchMessage(6, 12, 31)).toBe("Read 6 pages (12 of 31)");
    expect(fetchBatchMessage(1, 1, 31)).toBe("Read 1 page (1 of 31)");
    expect(extractBatchMessage(4, 8, 31)).toBe("Pulled facts from 4 pages (8 of 31)");
    expect(factSheetReadyMessage({ found: 31, conflict: 3, missing: 12 })).toBe(
      "Fact sheet ready: 31 found, 3 contradicted, 12 missing",
    );
  });

  it("turns any thrown value into one short line", () => {
    expect(errorText(new Error("fetch failed\n  at somewhere"))).toBe("fetch failed at somewhere");
    expect(errorText("plain")).toBe("plain");
    expect(errorText(undefined)).toBe("Unknown error");
    expect(errorText(new Error("x".repeat(400))).length).toBe(300);
  });
});

describe("platform across pages", () => {
  const wp = (url: string, value: string): PlatformDetection => ({
    platform: "wordpress",
    evidence: [{ signal: "wordpress: wp-content asset path", value, url }],
  });

  it("starts from an unknown run and picks the platform most pages agree on", () => {
    const merged = mergeSitePlatform({ platform: "unknown", evidence: [] }, [
      wp("https://a.com/", "/wp-content/themes/x/style.css"),
      wp("https://a.com/about", "/wp-content/themes/x/style.css"),
      { platform: "other", evidence: [] },
    ]);
    expect(merged.platform).toBe("wordpress");
    expect(merged.evidence).toHaveLength(1);
    expect(merged.evidence[0].signal).toBe("wordpress: wp-content asset path");
  });

  it("keeps what the run already found when a batch adds nothing", () => {
    const current = { platform: "shopify" as const, evidence: [{ signal: "shopify: Shopify CDN asset", value: "cdn.shopify.com/x" }] };
    expect(mergeSitePlatform(current, [])).toEqual(current);
    const merged = mergeSitePlatform(current, [{ platform: "other", evidence: [] }]);
    expect(merged.platform).toBe("shopify");
    expect(merged.evidence).toEqual(current.evidence);
  });

  it("lets a named platform beat other once the evidence is in", () => {
    const merged = mergeSitePlatform({ platform: "other", evidence: [] }, [
      wp("https://a.com/team", "/wp-content/uploads/team.jpg"),
    ]);
    expect(merged.platform).toBe("wordpress");
  });
});

describe("pages and the fact sheet", () => {
  it("matches the home page across scheme, www, and trailing slash", () => {
    expect(isHomePage("http://www.legiit.com/", "https://legiit.com")).toBe(true);
    expect(isHomePage("https://legiit.com/about", "https://legiit.com")).toBe(false);
    expect(isHomePage("https://legiit.com/", null)).toBe(false);
    expect(pageKey("https://www.Legiit.com/About/?utm_source=x")).toBe("legiit.com/About");
  });

  it("attaches the page url to every schema block", () => {
    const block = { data: { "@type": "Organization" }, raw: "{}", types: ["Organization"] };
    const out = existingSchemaOf([
      { url: "https://a.com/", jsonld: [block, block] },
      { url: "https://a.com/about", jsonld: [] },
      { url: "https://a.com/x", jsonld: null as unknown as [] },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ url: "https://a.com/", ...block });
  });

  it("reads the company name only when it is a string", () => {
    expect(
      companyNameFrom({
        templateId: "about-v1",
        fields: { company_name: { value: "  Legiit ", status: "found", evidence: [] } },
      }),
    ).toBe("Legiit");
    expect(
      companyNameFrom({
        templateId: "about-v1",
        fields: { company_name: { value: null, status: "missing", evidence: [] } },
      }),
    ).toBeNull();
    expect(companyNameFrom({ templateId: "about-v1", fields: {} })).toBeNull();
  });

  it("copies a fetched page into a new run with the findings reset", () => {
    const row = reusedPageRow(
      {
        url: "https://a.com/about",
        normalized_url: "a.com/about",
        rank: 1,
        reason: "about page",
        title: "About",
        meta_description: "d",
        canonical: "https://a.com/about",
        lang: "en",
        text: "# About",
        text_chars: 7,
        headings: [{ level: 1, text: "About" }],
        html_path: "p/r/x.html",
        html_bytes: 1000,
        jsonld: [],
        links: { tel: ["+1"] },
        images: [],
        http_status: 200,
        fetched_at: "2026-11-05T09:00:00.000Z",
      },
      { runId: "run2", projectId: "proj", userId: "user" },
    );
    expect(row.run_id).toBe("run2");
    expect(row.project_id).toBe("proj");
    expect(row.user_id).toBe("user");
    expect(row.status).toBe("fetched");
    expect(row.findings).toBeNull();
    expect(row.findings_dropped).toBe(0);
    expect(row.error).toBeNull();
    expect(row.text).toBe("# About");
    expect(row.html_path).toBe("p/r/x.html");
    expect(row.fetched_at).toBe("2026-11-05T09:00:00.000Z");
    expect(row.links).toEqual({ tel: ["+1"] });
  });
});
