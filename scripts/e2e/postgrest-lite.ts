/*
  A stand-in for PostgREST and Supabase Storage, for the local end-to-end run
  (pnpm e2e:local). It answers the part of the PostgREST protocol supabase-js
  uses in this app: select, insert, upsert, update, and delete; the eq, neq,
  lt, lte, gt, gte, is, in, not, and or filters; order, limit, and offset; and
  single and maybe-single responses.

  It builds the SQL PostgREST builds. Rows go in through
  json_populate_recordset with the `columns` list, so a key missing from one
  row of a bulk insert becomes NULL exactly as it does in production, and come
  out through json_agg, so timestamps, numbers, enums, and JSON are formatted by
  PostgreSQL itself. Constraint, enum, and NOT NULL errors are PostgreSQL's own,
  answered with PostgREST's status codes.

  It connects as the database owner, like the service role, so RLS is not in
  play here; pnpm db:check covers the policies.
*/
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseError, Pool } from "pg";

export interface PostgrestLite {
  /** The base URL to give supabase-js, e.g. http://127.0.0.1:54321. */
  url: string;
  /** Stored objects by "bucket/path". */
  objects: Map<string, Buffer>;
  /** One line per request: method, path, and status. */
  log: string[];
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string | null = null,
  ) {
    super(message);
  }
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new HttpError(400, "PGRST100", `unsupported column name: ${name}`);
  return `"${name}"`;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type Cond = { col: string; negate: boolean; op: string; value: string; quoted: boolean };

const OPERATORS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  ilike: "ILIKE",
};

/** Splits on commas outside double quotes and parentheses. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let current = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      current += ch;
      if (ch === "\\" && i + 1 < s.length) {
        current += s[++i];
      } else if (ch === '"') {
        inQuote = false;
      }
      continue;
    }
    if (ch === '"') inQuote = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/** Inside `or` trees and `in` lists, PostgREST strips double quotes and their backslash escapes. */
function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(.)/g, "$1");
  return v;
}

/** "eq.5", "not.is.null", "in.(a,b)" for column `col`. `quoted` marks a value inside an or tree. */
function parseCond(col: string, raw: string, quoted: boolean): Cond {
  let rest = raw;
  let negate = false;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const op = dot < 0 ? rest : rest.slice(0, dot);
  if (dot < 0 || !(op in OPERATORS || op === "is" || op === "in")) {
    throw new HttpError(400, "PGRST100", `"failed to parse filter (${col}=${raw})"`);
  }
  ident(col);
  return { col, negate, op, value: rest.slice(dot + 1), quoted };
}

function parseOr(raw: string): Cond[] {
  const inner = raw.trim().replace(/^\(/, "").replace(/\)$/, "");
  return splitTopLevel(inner).map((item) => {
    const dot = item.indexOf(".");
    if (dot < 0) throw new HttpError(400, "PGRST100", `"failed to parse logic tree (${raw})"`);
    return parseCond(item.slice(0, dot), item.slice(dot + 1), true);
  });
}

function condSql(c: Cond, params: unknown[], alias: string): string {
  const col = `${alias}.${ident(c.col)}`;
  let sql: string;
  if (c.op === "is") {
    const v = c.value.toLowerCase();
    if (!["null", "true", "false", "unknown"].includes(v)) {
      throw new HttpError(400, "PGRST100", `"failed to parse filter (is.${c.value})"`);
    }
    sql = `${col} IS ${v.toUpperCase()}`;
  } else if (c.op === "in") {
    const inner = c.value.trim().replace(/^\(/, "").replace(/\)$/, "");
    const items = inner ? splitTopLevel(inner).map(unquote) : [];
    if (!items.length) {
      sql = "FALSE";
    } else {
      sql = `${col} IN (${items
        .map((v) => {
          params.push(v);
          return `$${params.length}`;
        })
        .join(", ")})`;
    }
  } else {
    let v = c.quoted ? unquote(c.value) : c.value;
    if (c.op === "like" || c.op === "ilike") v = v.replace(/\*/g, "%");
    params.push(v);
    sql = `${col} ${OPERATORS[c.op]} $${params.length}`;
  }
  return c.negate ? `NOT (${sql})` : sql;
}

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "or", "and"]);

function whereSql(search: URLSearchParams, params: unknown[], alias: string): string {
  const parts: string[] = [];
  for (const [key, value] of search) {
    if (key === "or") {
      parts.push(`(${parseOr(value).map((c) => condSql(c, params, alias)).join(" OR ")})`);
    } else if (key === "and") {
      parts.push(`(${parseOr(value).map((c) => condSql(c, params, alias)).join(" AND ")})`);
    } else if (!RESERVED_PARAMS.has(key)) {
      parts.push(condSql(parseCond(key, value, false), params, alias));
    }
  }
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

function selectList(search: URLSearchParams, alias: string): string {
  const raw = search.get("select") ?? "*";
  if (raw === "*") return `${alias}.*`;
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      if (c.includes("(") || c.includes(":")) throw new HttpError(400, "PGRST100", `unsupported select item: ${c}`);
      return `${alias}.${ident(c)}`;
    })
    .join(", ");
}

function orderSql(search: URLSearchParams, alias: string): string {
  const raw = search.get("order");
  if (!raw) return "";
  const items = raw.split(",").map((item) => {
    const [col, ...mods] = item.split(".");
    let sql = `${alias}.${ident(col)}`;
    for (const m of mods) {
      if (m === "asc") sql += " ASC";
      else if (m === "desc") sql += " DESC";
      else if (m === "nullsfirst") sql += " NULLS FIRST";
      else if (m === "nullslast") sql += " NULLS LAST";
      else throw new HttpError(400, "PGRST100", `unsupported order modifier: ${m}`);
    }
    return sql;
  });
  return ` ORDER BY ${items.join(", ")}`;
}

function limitSql(search: URLSearchParams): string {
  let sql = "";
  const limit = search.get("limit");
  const offset = search.get("offset");
  if (limit !== null) {
    if (!/^\d+$/.test(limit)) throw new HttpError(400, "PGRST100", `bad limit: ${limit}`);
    sql += ` LIMIT ${limit}`;
  }
  if (offset !== null) {
    if (!/^\d+$/.test(offset)) throw new HttpError(400, "PGRST100", `bad offset: ${offset}`);
    sql += ` OFFSET ${offset}`;
  }
  return sql;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function prefer(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  const raw = req.headers.prefer;
  for (const part of (Array.isArray(raw) ? raw.join(",") : (raw ?? "")).split(",")) {
    const [k, v] = part.trim().split("=");
    if (k) out.set(k, v ?? "");
  }
  return out;
}

function wantsObject(req: IncomingMessage): boolean {
  return (req.headers.accept ?? "").includes("application/vnd.pgrst.object+json");
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  return Buffer.concat(chunks);
}

function columnsOf(search: URLSearchParams, rows: Record<string, unknown>[]): string[] {
  const listed = search.get("columns");
  if (listed) return listed.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  return Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
}

type Statement = { sql: string; params: unknown[]; returns: boolean };

function statementFor(method: string, table: string, search: URLSearchParams, req: IncomingMessage, body: unknown): Statement {
  const t = `public.${ident(table)}`;
  const params: unknown[] = [];
  const prefs = prefer(req);
  const representation = prefs.get("return") === "representation";

  if (method === "GET") {
    const where = whereSql(search, params, "_tgt");
    const inner = `SELECT ${selectList(search, "_tgt")} FROM ${t} AS _tgt${where}${orderSql(search, "_tgt")}${limitSql(search)}`;
    return { sql: wrap(inner), params, returns: true };
  }

  if (method === "POST") {
    const rows = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
    if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
      throw new HttpError(400, "PGRST102", "All object keys must match");
    }
    const cols = columnsOf(search, rows).map(ident);
    params.push(JSON.stringify(rows));
    let conflict = "";
    const onConflict = search.get("on_conflict");
    const resolution = prefs.get("resolution");
    if (resolution === "ignore-duplicates" || resolution === "merge-duplicates") {
      const target = onConflict ? onConflict.split(",").map((c) => ident(c.trim())).join(", ") : null;
      if (!target) throw new HttpError(400, "PGRST100", "upsert needs on_conflict here");
      conflict =
        resolution === "ignore-duplicates"
          ? ` ON CONFLICT (${target}) DO NOTHING`
          : ` ON CONFLICT (${target}) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`;
    }
    const insert = `INSERT INTO ${t} (${cols.join(", ")}) SELECT ${cols.join(", ")} FROM json_populate_recordset(NULL::${t}, $1::json)${conflict} RETURNING *`;
    const inner = `SELECT ${selectList(search, "_m")} FROM _mut AS _m`;
    return { sql: `WITH _mut AS (${insert}) ${wrap(inner)}`, params, returns: representation };
  }

  if (method === "PATCH") {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "PGRST102", "Empty or invalid json");
    const cols = Object.keys(body as Record<string, unknown>).map(ident);
    if (!cols.length) throw new HttpError(400, "PGRST102", "Empty update");
    params.push(JSON.stringify(body));
    const where = whereSql(search, params, "_tgt");
    const update = `UPDATE ${t} AS _tgt SET ${cols.map((c) => `${c} = _src.${c}`).join(", ")} FROM (SELECT * FROM json_populate_record(NULL::${t}, $1::json)) AS _src${where} RETURNING _tgt.*`;
    const inner = `SELECT ${selectList(search, "_m")} FROM _mut AS _m`;
    return { sql: `WITH _mut AS (${update}) ${wrap(inner)}`, params, returns: representation };
  }

  if (method === "DELETE") {
    const where = whereSql(search, params, "_tgt");
    const del = `DELETE FROM ${t} AS _tgt${where} RETURNING _tgt.*`;
    const inner = `SELECT ${selectList(search, "_m")} FROM _mut AS _m`;
    return { sql: `WITH _mut AS (${del}) ${wrap(inner)}`, params, returns: representation };
  }

  throw new HttpError(405, "PGRST117", `Unsupported HTTP method: ${method}`);
}

/** The rows as a JSON array and their count, the way PostgREST shapes its responses. */
function wrap(inner: string): string {
  return `SELECT coalesce(json_agg(_r), '[]'::json)::text AS body, count(*)::int AS n FROM (${inner}) AS _r`;
}

/** PostgREST's status for a PostgreSQL error code. */
function statusForSqlState(code: string | undefined): number {
  if (!code) return 500;
  if (code === "23505" || code === "23503") return 409;
  if (code === "42501") return 403;
  if (code === "42P01") return 404;
  if (code.startsWith("22") || code.startsWith("23") || code === "42703" || code === "42804" || code === "P0001") return 400;
  return 500;
}

function sendJson(res: ServerResponse, status: number, body: unknown, contentType = "application/json; charset=utf-8") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": contentType, "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function handleRest(pool: Pool, req: IncomingMessage, res: ServerResponse, table: string, search: URLSearchParams) {
  const method = req.method ?? "GET";
  const raw = await readBody(req);
  let body: unknown = null;
  if (raw.length) {
    try {
      body = JSON.parse(raw.toString("utf8")) as unknown;
    } catch {
      throw new HttpError(400, "PGRST102", "Empty or invalid json");
    }
  }
  const stmt = statementFor(method, table, search, req, body);
  const single = wantsObject(req);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let result;
    try {
      result = await client.query<{ body: string; n: number }>(stmt.sql, stmt.params);
    } catch (e) {
      await client.query("ROLLBACK");
      const err = e as DatabaseError;
      sendJson(res, statusForSqlState(err.code), {
        code: err.code ?? "XX000",
        message: err.message,
        details: err.detail ?? null,
        hint: err.hint ?? null,
      });
      return;
    }
    const { body: json, n } = result.rows[0];
    if (single && (stmt.returns || method === "GET") && n !== 1) {
      // PostgREST rolls a mutation back when the single-object check fails.
      await client.query("ROLLBACK");
      sendJson(res, 406, {
        code: "PGRST116",
        details: `The result contains ${n} rows`,
        hint: null,
        message: "Cannot coerce the result to a single JSON object",
      });
      return;
    }
    await client.query("COMMIT");

    const created = method === "POST";
    if (method !== "GET" && !stmt.returns) {
      res.writeHead(created ? 201 : 204);
      res.end();
      return;
    }
    if (single) {
      const rows = JSON.parse(json) as unknown[];
      sendJson(res, created ? 201 : 200, JSON.stringify(rows[0]), "application/vnd.pgrst.object+json; charset=utf-8");
      return;
    }
    sendJson(res, created ? 201 : 200, json);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function handleStorage(
  pool: Pool,
  objects: Map<string, Buffer>,
  req: IncomingMessage,
  res: ServerResponse,
  objectPath: string,
) {
  const path = objectPath.replace(/^(authenticated|public)\//, "");
  const slash = path.indexOf("/");
  const bucket = slash < 0 ? path : path.slice(0, slash);
  const key = slash < 0 ? "" : path.slice(slash + 1);
  const known = await pool.query("SELECT 1 FROM storage.buckets WHERE id = $1", [bucket]);
  if (!known.rowCount) {
    sendJson(res, 400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    return;
  }
  const method = req.method ?? "GET";
  if (method === "POST" || method === "PUT") {
    const data = await readBody(req);
    const exists = objects.has(`${bucket}/${key}`);
    if (exists && method === "POST" && req.headers["x-upsert"] !== "true") {
      sendJson(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      return;
    }
    objects.set(`${bucket}/${key}`, data);
    sendJson(res, 200, { Key: `${bucket}/${key}`, Id: randomUUID() });
    return;
  }
  if (method === "GET") {
    const data = objects.get(`${bucket}/${key}`);
    if (!data) {
      sendJson(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": data.length });
    res.end(data);
    return;
  }
  sendJson(res, 405, { statusCode: "405", error: "Method not allowed", message: method });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startPostgrestLite(pool: Pool): Promise<PostgrestLite> {
  const objects = new Map<string, Buffer>();
  const log: string[] = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const done = () => log.push(`${req.method} ${url.pathname}${url.search} ${res.statusCode}`);
    res.on("finish", done);

    const rest = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    const storage = /^\/storage\/v1\/object\/(.+)$/.exec(url.pathname);
    const work = rest
      ? handleRest(pool, req, res, rest[1], url.searchParams)
      : storage
        ? handleStorage(pool, objects, req, res, decodeURIComponent(storage[1]))
        : Promise.reject(new HttpError(404, "PGRST125", `Invalid path ${url.pathname}`));

    work.catch((e: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof HttpError) {
        sendJson(res, e.status, { code: e.code, message: e.message, details: e.details, hint: null });
      } else {
        sendJson(res, 500, { code: "XX000", message: e instanceof Error ? e.message : String(e), details: null, hint: null });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    objects,
    log,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
