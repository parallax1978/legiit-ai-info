import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { originFromHeaders } from "../redirects";

/** The header's sign-out form posts here. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", originFromHeaders(request.headers)), { status: 303 });
}
