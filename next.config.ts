import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is left off on purpose: every signed-in screen reads the
  // session cookie, so the conventional dynamic rendering model is the better fit.
  // See CLAUDE.md, "Decisions".
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
