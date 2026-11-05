import "server-only";

/*
  What every route handler under /api repeats: the signed-in user from the
  session cookie, JSON errors with a short message, and body parsing. Never
  a stack trace in a response.
*/
import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

/** The signed-in user, validated with Supabase, or a 401 response. */
export async function requireApiUser(): Promise<{ user: User; response?: undefined } | { user?: undefined; response: NextResponse }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { response: jsonError(401, "Sign in to continue.") };
    return { user };
  } catch (e) {
    console.error("auth check failed:", e instanceof Error ? e.message : e);
    return { response: jsonError(401, "Sign in to continue.") };
  }
}

/** The JSON body, or undefined when there is none or it does not parse. An empty body is {}. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids are uuids; anything else is a 404 before it reaches the database. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Logs the error server-side and answers with a short message. */
export function serverError(context: string, e: unknown, message = "Something went wrong. Try again in a moment."): NextResponse {
  console.error(`${context}:`, e instanceof Error ? e.message : e);
  return jsonError(500, message);
}
