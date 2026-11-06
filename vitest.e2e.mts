import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** The end-to-end run. Not part of pnpm test; run with pnpm e2e:local or pnpm e2e:supabase. */
export default defineConfig({
  test: {
    include: ["scripts/e2e/**/*.e2e.ts"],
    environment: "node",
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
