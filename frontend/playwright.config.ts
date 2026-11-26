import { defineConfig, devices } from "@playwright/test";

// Browser tests drive the real app end to end. They start their own API on
// :4100 against a freshly seeded <db>_e2e database (backend/scripts/
// e2e-server.ts) and their own site on :5180, so dev servers on :4000/:5173,
// development data and the live site are never touched.
const API = "http://localhost:4100";
const SITE = "http://localhost:5180";

export default defineConfig({
  testDir: "./e2e",
  // One story, one shared database: steps run in order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: SITE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Locally use the installed Chrome; CI installs Playwright's Chromium.
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm --prefix ../backend run e2e:server",
      url: `${API}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: "npx vite --port 5180 --strictPort",
      url: SITE,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_BASE_URL: API },
    },
  ],
});
