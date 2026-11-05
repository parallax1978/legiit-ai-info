import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/types";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Server client bound to the request's session cookie. RLS applies, so this is
 * the client for anything that reads or writes on the user's behalf in Server
 * Components, Server Actions, and Route Handlers.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there and the
          // proxy refreshes the session instead.
        }
      },
    },
  });
}
