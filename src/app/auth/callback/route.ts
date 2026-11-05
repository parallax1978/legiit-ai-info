import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { nextUrl, originFromHeaders, safeNext } from "../redirects";

/*
  Where the magic link and the Google redirect land. Supabase sends either a
  PKCE `code` or a `token_hash` + `type` pair; both become a session cookie,
  then the browser continues to `next`.
*/
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const origin = originFromHeaders(request.headers);

  const supabase = await createClient();
  let ok = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
  }

  return NextResponse.redirect(nextUrl(ok ? next : "/login?error=link", origin), { status: 303 });
}
