import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** The local end-to-end run on PostgreSQL. Not part of pnpm test; run with pnpm e2e:local. */
export default defineConfig({
  test: {
    include: ["scripts/e2e/**/*.e2e.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
