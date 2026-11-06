/*
  The database behind the end-to-end run: either the local stand-in (a
  PostgreSQL the test recreates, served through postgrest-lite) or a real
  Supabase project (E2E_BACKEND=supabase, keys from .env.local).

  Both give the test the same thing: a service-role supabase-js client for
  assertions, two auth users, a way to check a stored object, and the
  environment the app's own clients read. On Supabase the users are real auth
  users made with the admin API, and their data from an earlier run is
  removed before the run starts, so the run is the same every time.
*/
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client, Pool } from "pg";
import type { Database } from "@/lib/db/types";
import { startPostgrestLite, type PostgrestLite } from "./postgrest-lite";

export type BackendKind = "local" | "supabase";

export const BACKEND: BackendKind = process.env.E2E_BACKEND === "supabase" ? "supabase" : "local";

export interface TestUser {
  id: string;
  email: string;
  /** Set on Supabase, where the user can sign in; empty on the local stand-in. */
  password: string;
}

export interface Backend {
  kind: BackendKind;
  url: string;
  publishableKey: string;
  secretKey: string;
  owner: TestUser;
  other: TestUser;
  /** Service-role client, for reading what the app wrote. */
  read: SupabaseClient<Database>;
  objectExists(bucket: string, path: string): Promise<boolean>;
  close(): Promise<void>;
}

const HTML_BUCKET = "crawl-html";

function serviceClient(url: string, key: string): SupabaseClient<Database> {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// ---------------------------------------------------------------------------
// Local: PostgreSQL plus the PostgREST stand-in
// ---------------------------------------------------------------------------

const PG = {
  host: process.env.E2E_PG_HOST ?? "/tmp",
  port: Number(process.env.E2E_PG_PORT ?? 54329),
  user: process.env.E2E_PG_USER ?? "postgres",
};
const LOCAL_DB = "lai_e2e";

const LOCAL_OWNER: TestUser = { id: "11111111-1111-4111-8111-111111111111", email: "owner@acme-roofing.example", password: "" };
const LOCAL_OTHER: TestUser = { id: "22222222-2222-4222-8222-222222222222", email: "other@example.com", password: "" };

async function startLocal(): Promise<Backend> {
  const admin = new Client({ ...PG, database: "postgres" });
  await admin.connect();
  await admin.query(`drop database if exists ${LOCAL_DB} with (force)`);
  await admin.query(`create database ${LOCAL_DB}`);
  await admin.end();

  const pool = new Pool({ ...PG, database: LOCAL_DB, max: 16 });
  const migrations = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join("supabase/migrations", f));
  for (const file of ["supabase/test/harness.sql", ...migrations]) await pool.query(readFileSync(file, "utf8"));
  await pool.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [
    LOCAL_OWNER.id,
    LOCAL_OWNER.email,
    LOCAL_OTHER.id,
    LOCAL_OTHER.email,
  ]);

  const rest: PostgrestLite = await startPostgrestLite(pool);
  const secretKey = "sb_secret_e2e";
  process.env.NEXT_PUBLIC_SUPABASE_URL = rest.url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_e2e";
  process.env.SUPABASE_SECRET_KEY = secretKey;

  return {
    kind: "local",
    url: rest.url,
    publishableKey: "sb_publishable_e2e",
    secretKey,
    owner: LOCAL_OWNER,
    other: LOCAL_OTHER,
    read: serviceClient(rest.url, secretKey),
    objectExists: async (bucket, path) => rest.objects.has(`${bucket}/${path}`),
    close: async () => {
      await rest.close();
      await pool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase: the real project named in .env.local
// ---------------------------------------------------------------------------

/** Loads KEY=VALUE lines from .env.local into process.env, without overriding values already set. */
export function loadEnvLocal(path = ".env.local"): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[m[1]] && value) process.env[m[1]] = value;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; put the Supabase project's values in .env.local (see .env.example)`);
  return value;
}

/** Makes the auth user, or finds it, and sets its password for this run. */
async function ensureUser(read: SupabaseClient<Database>, email: string, password: string): Promise<TestUser> {
  const created = await read.auth.admin.createUser({ email, password, email_confirm: true });
  if (!created.error) return { id: created.data.user.id, email, password };
  if (created.error.code !== "email_exists" && !/already/i.test(created.error.message)) {
    throw new Error(`create auth user ${email}: ${created.error.message}`);
  }
  const listed = await read.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw new Error(`list auth users: ${listed.error.message}`);
  const user = listed.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`auth user ${email} exists but was not listed`);
  const updated = await read.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (updated.error) throw new Error(`set password for ${email}: ${updated.error.message}`);
  return { id: user.id, email, password };
}

async function removeStoredHtml(read: SupabaseClient<Database>, projectId: string): Promise<void> {
  const bucket = read.storage.from(HTML_BUCKET);
  const runs = await bucket.list(projectId);
  if (runs.error) throw new Error(`list stored html: ${runs.error.message}`);
  for (const run of runs.data) {
    const files = await bucket.list(`${projectId}/${run.name}`);
    if (files.error) throw new Error(`list stored html: ${files.error.message}`);
    const paths = files.data.filter((f) => f.id).map((f) => `${projectId}/${run.name}/${f.name}`);
    if (paths.length) {
      const removed = await bucket.remove(paths);
      if (removed.error) throw new Error(`remove stored html: ${removed.error.message}`);
    }
  }
}

/** Removes what an earlier run left for these users: projects (and everything under them), cost rows, usage events, stored HTML. */
async function cleanUp(read: SupabaseClient<Database>, userIds: string[]): Promise<void> {
  const projects = await read.from("projects").select("id").in("user_id", userIds);
  if (projects.error) throw new Error(`list projects: ${projects.error.message}`);
  for (const p of projects.data) await removeStoredHtml(read, p.id);
  for (const table of ["llm_calls", "usage_events", "projects"] as const) {
    const { error } = await read.from(table).delete().in("user_id", userIds);
    if (error) throw new Error(`clean ${table}: ${error.message}`);
  }
}

async function startSupabase(): Promise<Backend> {
  loadEnvLocal();
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? required("SUPABASE_SERVICE_ROLE_KEY");
  const read = serviceClient(url, secretKey);

  const password = randomBytes(18).toString("base64url");
  const owner = await ensureUser(read, "e2e-owner@legiit-ai-info.test", password);
  const other = await ensureUser(read, "e2e-other@legiit-ai-info.test", password);
  await cleanUp(read, [owner.id, other.id]);

  return {
    kind: "supabase",
    url,
    publishableKey,
    secretKey,
    owner,
    other,
    read,
    objectExists: async (bucket, path) => {
      const { error } = await read.storage.from(bucket).download(path);
      return !error;
    },
    close: async () => undefined,
  };
}

export function startBackend(): Promise<Backend> {
  return BACKEND === "supabase" ? startSupabase() : startLocal();
}

/** A client that signs in as a test user with the publishable key: what the browser gets. */
export async function signedInClient(backend: Backend, user: TestUser): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(backend.url, backend.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`sign in as ${user.email}: ${error.message}`);
  return client;
}

/** A client with the publishable key and no session: what anyone on the internet gets. */
export function anonClient(backend: Backend): SupabaseClient<Database> {
  return createClient<Database>(backend.url, backend.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
