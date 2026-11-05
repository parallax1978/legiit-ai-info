import "server-only";

/*
  Keeps the templates table in step with the spec in src/templates. The spec
  is TypeScript first and data second: a project row references the template
  id, so the row has to exist before the first project is inserted.
*/
import type { ServiceClient } from "@/lib/supabase/service";
import type { TemplateSpec } from "@/templates/types";

/** Template versions this process has already confirmed in the database. */
const seeded = new Map<string, number>();

/**
 * Upserts the template row when it is missing or older than the spec. Runs
 * the check once per template version per process.
 */
export async function ensureTemplate(db: ServiceClient, spec: TemplateSpec): Promise<void> {
  const known = seeded.get(spec.id);
  if (known !== undefined && known >= spec.version) return;

  const { data, error } = await db.from("templates").select("id, version").eq("id", spec.id).maybeSingle();
  if (error) throw new Error(`read template: ${error.message}`);

  if (!data || data.version < spec.version) {
    const { error: upsertError } = await db
      .from("templates")
      .upsert({ id: spec.id, version: spec.version, name: spec.name, spec }, { onConflict: "id" });
    if (upsertError) throw new Error(`seed template: ${upsertError.message}`);
    seeded.set(spec.id, spec.version);
    return;
  }

  seeded.set(spec.id, data.version);
}

/** For tests and re-seeding after a migration: forget what this process confirmed. */
export function resetTemplateCache(): void {
  seeded.clear();
}
