"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";
import { supabasePublishableKey, supabaseUrl } from "./env";

/** Browser client. Uses the session cookie; RLS applies. */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabasePublishableKey());
}
