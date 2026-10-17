import path from "node:path";
import { defineConfig } from "vitest/config";
import { loadEnv, requireEnv } from "./scripts/env.ts";

loadEnv();

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/globalSetup.ts"],
    // Integration test files share one database and truncate it; run them serially.
    fileParallelism: false,
    env: {
      // App code (src/lib/db/pool.ts) reads DATABASE_URL; point it at the test DB.
      DATABASE_URL: requireEnv("TEST_DATABASE_URL"),
    },
  },
});
