import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { config } from "@/config";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user, or null. Validated with Supabase on every call. */
export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** The signed-in user, or a redirect to /login. For pages and actions. */
export async function requireUser(next?: string): Promise<User> {
  const user = await getUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return config.adminEmails.includes(email.toLowerCase());
}

/** The signed-in admin, or a redirect. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser("/admin");
  if (!isAdminEmail(user.email)) redirect("/app");
  return user;
}
