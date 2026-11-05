import { NextResponse } from "next/server";

/** Vercel checks and uptime monitors. */
export function GET() {
  return NextResponse.json({ ok: true });
}
