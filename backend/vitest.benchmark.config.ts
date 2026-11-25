import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/benchmark.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
  },
});
