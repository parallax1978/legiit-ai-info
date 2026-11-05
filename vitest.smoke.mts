import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Live checks that hit the network. Not part of pnpm test; run with pnpm smoke:crawl. */
export default defineConfig({
  test: {
    include: ["scripts/**/*.smoke.ts"],
    environment: "node",
    testTimeout: 600_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
