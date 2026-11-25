import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The benchmark replay needs a database of its own; `npm run benchmark`
    // creates one and runs it there (see scripts/benchmark.ts).
    exclude: ["**/node_modules/**", "src/benchmark.test.ts"],
    // Tests must never write to the real Supabase bucket, so blank these.
    // Empty (not unset) so Prisma's .env loading can't fill them back in;
    // storage then falls back to local disk, which the PDF tests expect.
    env: { SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
  },
});
