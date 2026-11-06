import "server-only";

/*
  The share link, and the reads the output routes repeat (zip, html, share,
  and the public page at /s/[token]), in the style of src/lib/runs/db.ts:
  every query takes the service client, throws a DbError with a short message
  on failure, and returns typed rows. The token, expiry, URL, file list, file
  name, and response header helpers are pure and tested in share.test.ts.
*/
import { randomBytes } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import type { Database, FactSheetRow, GenerationRow, ProjectRow, ShareLinkRow } from "@/lib/db/types";
import type { FactSheetData } from "@/lib/facts/types";
import { DbError, type Db } from "@/lib/runs/db";
import type { ZipFile } from "./zip";

export { DbError, type Db };

type Tables = Database["public"]["Tables"];
export type ShareLinkInsert = Tables["share_links"]["Insert"];

type PostgrestResult = { data: unknown; error: PostgrestError | null };

/** The data of a successful PostgREST response; the failure branch contributes nothing. */
type DataOf<R extends PostgrestResult> = R extends { error: null; data: infer D } ? D : never;

function check(what: string, res: { error: PostgrestError | null }): void {
  if (res.error) throw new DbError(what, res.error);
}

function must<R extends PostgrestResult>(what: string, res: R): NonNullable<DataOf<R>> {
  if (res.error) throw new DbError(what, res.error);
  if (res.data === null || res.data === undefined) throw new Error(`${what}: no row returned`);
  return res.data as NonNullable<DataOf<R>>;
}

function maybe<R extends PostgrestResult>(what: string, res: R): NonNullable<DataOf<R>> | null {
  if (res.error) throw new DbError(what, res.error);
  return (res.data ?? null) as NonNullable<DataOf<R>> | null;
}

// ---------------------------------------------------------------------------
// Pure parts: tokens, expiry, URLs, files, headers
// ---------------------------------------------------------------------------

/** 24 random bytes, base64url: 32 characters, no padding. */
export const SHARE_TOKEN_BYTES = 24;
export const SHARE_LINK_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function newShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

/** Anything that is not base64url of a sane length is a 404 before it reaches the database. */
export function isShareToken(token: string): boolean {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function shareExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + SHARE_LINK_DAYS * DAY_MS).toISOString();
}

/** A link with no expiry never expires; one with an unreadable expiry is treated as expired. */
export function isShareLinkLive(link: Pick<ShareLinkRow, "expires_at">, now: Date = new Date()): boolean {
  if (link.expires_at === null || link.expires_at === undefined) return true;
  const t = Date.parse(link.expires_at);
  return Number.isFinite(t) && t > now.getTime();
}

/** origin + "/s/" + token, whatever trailing slashes the origin carries. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.trim().replace(/\/+$/, "")}/s/${token}`;
}

/** "legiit.com-about-page.zip" from the project's site host; "about-page.zip" without one. */
export function zipFileName(host: string | null | undefined): string {
  const clean = (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return clean ? `${clean}-about-page.zip` : "about-page.zip";
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The stored schema is the @graph object; a JSON string (if one ever lands) is pretty-printed as well. */
function prettySchema(schema: NonNullable<GenerationRow["schema"]>): string {
  if (typeof schema === "string") {
    try {
      return pretty(JSON.parse(schema));
    } catch {
      return schema.endsWith("\n") ? schema : `${schema}\n`;
    }
  }
  return pretty(schema);
}

export type ZipSource = Pick<GenerationRow, "page_html" | "wordpress_html" | "schema" | "instructions_md">;

/**
 * The files in the download, in order. Only files with content are included,
 * so a download never holds an empty page or an empty schema.
 */
export function zipFilesFor(generation: ZipSource, factSheet: FactSheetData | null): ZipFile[] {
  const files: ZipFile[] = [];
  if (generation.page_html) files.push({ name: "about.html", data: generation.page_html });
  if (generation.wordpress_html) files.push({ name: "about-wordpress.html", data: generation.wordpress_html });
  if (generation.schema !== null && generation.schema !== undefined) {
    files.push({ name: "schema.json", data: prettySchema(generation.schema) });
  }
  if (generation.instructions_md) files.push({ name: "instructions.md", data: generation.instructions_md });
  if (factSheet) files.push({ name: "fact-sheet.json", data: pretty(factSheet) });
  return files;
}

/**
 * Headers for a page served from this origin (the owner's /html tab and the
 * public share page): not indexed, not cached by anything shared, no referrer
 * carrying the token to the links on the page, and no script may run even if
 * one ever slipped past the renderer's escaping. The page uses only inline
 * styles and https images, which the policy allows.
 */
export function pageResponseHeaders(): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "x-robots-tag": "noindex",
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  };
}

/** The 404 page for a share link that is missing, expired, or revoked. The same page for all three. */
export function notFoundPage(): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    "<title>Page not found</title>",
    "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;color:#1f2937;background:#f9fafb}main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:0;color:#4b5563}</style>",
    "</head>",
    "<body>",
    "<main>",
    "<h1>This page is not available</h1>",
    "<p>The link has expired or was removed. Ask the person who shared it for a new one.</p>",
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Generations and their inputs, as the output routes read them
// ---------------------------------------------------------------------------

export async function getGenerationForUser(db: Db, generationId: string, userId: string): Promise<GenerationRow | null> {
  return maybe(
    "read generation",
    await db.from("generations").select().eq("id", generationId).eq("user_id", userId).maybeSingle(),
  );
}

export type PageHtmlRow = Pick<GenerationRow, "page_html" | "status">;

/** The page of a generation, for the public share page; null until the generation is done. */
export async function getGenerationPageHtml(db: Db, generationId: string): Promise<string | null> {
  const row: PageHtmlRow | null = maybe(
    "read generation page",
    await db.from("generations").select("page_html, status").eq("id", generationId).maybeSingle(),
  );
  return row?.page_html ?? null;
}

export type ProjectHost = Pick<ProjectRow, "site_url" | "site_host">;

export async function getProjectHost(db: Db, projectId: string): Promise<ProjectHost | null> {
  return maybe("read project", await db.from("projects").select("site_url, site_host").eq("id", projectId).maybeSingle());
}

export async function getFactSheetData(db: Db, factSheetId: string): Promise<FactSheetData | null> {
  const row: Pick<FactSheetRow, "data"> | null = maybe(
    "read fact sheet",
    await db.from("fact_sheets").select("data").eq("id", factSheetId).maybeSingle(),
  );
  return row?.data ?? null;
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export async function getShareLinkByToken(db: Db, token: string): Promise<ShareLinkRow | null> {
  return maybe("read share link", await db.from("share_links").select().eq("token", token).maybeSingle());
}

/** Every share link of a generation, newest first; the caller picks the live one with isShareLinkLive. */
export async function listShareLinksForGeneration(db: Db, generationId: string): Promise<ShareLinkRow[]> {
  return must(
    "list share links",
    await db.from("share_links").select().eq("generation_id", generationId).order("created_at", { ascending: false }),
  );
}

export async function insertShareLink(db: Db, row: ShareLinkInsert): Promise<ShareLinkRow> {
  return must("insert share link", await db.from("share_links").insert(row).select().single());
}

export async function deleteShareLinksForGeneration(db: Db, generationId: string): Promise<void> {
  check("delete share links", await db.from("share_links").delete().eq("generation_id", generationId));
}
