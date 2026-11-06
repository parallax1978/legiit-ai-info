/*
  An in-memory stand-in for the PostgREST builder, for the billing tests:
  from(table) with select, insert, update, delete, eq, gte, lt, order, limit,
  range, maybeSingle, and single, resolved when awaited. Unique keys per table
  make a duplicate insert or update fail with code 23505 the way PostgreSQL
  does. Not a test file itself, so vitest does not run it.
*/
import type { Db } from "@/lib/runs/db";

export type FakeRow = Record<string, unknown>;

export interface FakeDbOptions {
  /** Column sets that must be unique per table, e.g. { profiles: [["stripe_customer_id"]] }. */
  unique?: Record<string, string[][]>;
}

type Op = "select" | "insert" | "update" | "delete";
type Filter = (row: FakeRow) => boolean;
type Mode = "many" | "maybe" | "single";

interface FakeError {
  code: string;
  message: string;
  details: string;
  hint: string;
  name: "PostgrestError";
}

function pgError(code: string, message: string): FakeError {
  return { code, message, details: "", hint: "", name: "PostgrestError" };
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export interface FakeDb {
  db: Db;
  tables: Record<string, FakeRow[]>;
}

export function fakeDb(tables: Record<string, FakeRow[]> = {}, options: FakeDbOptions = {}): FakeDb {
  const state: Record<string, FakeRow[]> = {};
  for (const [table, rows] of Object.entries(tables)) state[table] = rows.map((r) => ({ ...r }));
  let nextId = 1;

  function violatesUnique(table: string, candidate: FakeRow, except: FakeRow | null): boolean {
    const sets = options.unique?.[table] ?? [];
    const rows = state[table] ?? [];
    return sets.some((cols) => {
      if (cols.some((c) => candidate[c] === null || candidate[c] === undefined)) return false;
      return rows.some((r) => r !== except && cols.every((c) => r[c] === candidate[c]));
    });
  }

  function from(table: string) {
    const rows = (state[table] ??= []);
    const filters: Filter[] = [];
    const order: { col: string; asc: boolean }[] = [];
    let op: Op = "select";
    let payload: FakeRow | FakeRow[] | null = null;
    let returning = false;
    let mode: Mode = "many";
    let limitN: number | null = null;
    let offset = 0;

    function run(): { data: unknown; error: FakeError | null } {
      const matching = rows.filter((r) => filters.every((f) => f(r)));
      let out: FakeRow[];
      if (op === "select") {
        out = [...matching];
        for (const o of [...order].reverse()) out.sort((a, b) => (o.asc ? 1 : -1) * compare(a[o.col], b[o.col]));
        out = out.slice(offset, limitN === null ? undefined : offset + limitN);
      } else if (op === "insert") {
        const list = Array.isArray(payload) ? payload : payload ? [payload] : [];
        const made: FakeRow[] = [];
        for (const row of list) {
          const full: FakeRow = { id: `fake-${nextId++}`, created_at: new Date().toISOString(), ...row };
          if (violatesUnique(table, full, null)) return { data: null, error: pgError("23505", "duplicate key value") };
          rows.push(full);
          made.push(full);
        }
        out = made;
      } else if (op === "update") {
        const patch = payload && !Array.isArray(payload) ? payload : {};
        for (const row of matching) {
          if (violatesUnique(table, { ...row, ...patch }, row)) return { data: null, error: pgError("23505", "duplicate key value") };
        }
        for (const row of matching) Object.assign(row, patch);
        out = matching;
      } else {
        for (const row of matching) rows.splice(rows.indexOf(row), 1);
        out = matching;
      }
      const copies = out.map((r) => ({ ...r }));
      if (op !== "select" && !returning) return { data: null, error: null };
      if (mode === "many") return { data: copies, error: null };
      if (mode === "maybe") return { data: copies[0] ?? null, error: null };
      if (copies.length !== 1) return { data: null, error: pgError("PGRST116", `expected one row, got ${copies.length}`) };
      return { data: copies[0], error: null };
    }

    const builder = {
      select() {
        returning = true;
        return builder;
      },
      insert(v: FakeRow | FakeRow[]) {
        op = "insert";
        payload = v;
        return builder;
      },
      update(v: FakeRow) {
        op = "update";
        payload = v;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      eq(col: string, value: unknown) {
        filters.push((r) => r[col] === value);
        return builder;
      },
      gte(col: string, value: unknown) {
        filters.push((r) => compare(r[col], value) >= 0);
        return builder;
      },
      lt(col: string, value: unknown) {
        filters.push((r) => compare(r[col], value) < 0);
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        order.push({ col, asc: opts?.ascending ?? true });
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      range(from: number, to: number) {
        offset = from;
        limitN = to - from + 1;
        return builder;
      },
      maybeSingle() {
        mode = "maybe";
        return builder;
      },
      single() {
        mode = "single";
        return builder;
      },
      then<R1, R2>(
        resolve: (value: { data: unknown; error: FakeError | null }) => R1 | PromiseLike<R1>,
        reject?: (reason: unknown) => R2 | PromiseLike<R2>,
      ): Promise<R1 | R2> {
        return Promise.resolve().then(run).then(resolve, reject);
      },
    };
    return builder;
  }

  return { db: { from } as unknown as Db, tables: state };
}
