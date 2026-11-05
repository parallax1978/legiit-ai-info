import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/app/auth/redirects";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Refreshes the Supabase session on every request and keeps /app and /admin
 * behind sign-in. Route handlers under /api check the user themselves.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() validates the token with Supabase; do not trust getSession() here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const protectedPath = pathname.startsWith("/app") || pathname.startsWith("/admin");

  if (!user && protectedPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const params = request.nextUrl.searchParams;
    const url = request.nextUrl.clone();
    url.search = "";
    if (params.get("intent") === "new") {
      // The "scan your site" links carry intent=new and the site; a signed-in visitor goes straight to the form.
      const site = params.get("site")?.trim();
      url.pathname = "/app/new";
      if (site) url.searchParams.set("site", site);
    } else {
      // next may carry a query (/app/new?site=...), so it is parsed rather than assigned to pathname.
      const target = new URL(safeNext(params.get("next")), request.nextUrl.origin);
      url.pathname = target.pathname;
      url.search = target.search;
    }
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|og.png|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
