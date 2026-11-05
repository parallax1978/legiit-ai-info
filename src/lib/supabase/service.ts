import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { supabaseSecretKey, supabaseUrl } from "./env";

export type ServiceClient = SupabaseClient<Database>;

let cached: ServiceClient | null = null;

/**
 * Service-role client. Bypasses RLS. Server code only, and only after the
 * caller has checked that the user owns what it is about to touch.
 */
export function createServiceClient(): ServiceClient {
  if (cached) return cached;
  cached = createSupabaseClient<Database>(supabaseUrl(), supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}
