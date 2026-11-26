import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Records the section 5 demo video into demo-output/ as a .webm (YouTube and
// Drive both accept it).
//   Rehearsal on an empty local copy:  E2E_EMPTY=1 DEMO_DRY=1 npm run demo:record
//   The real take on the live site:    DEMO_BASE_URL=https://… npm run demo:record
// On the live site the person recording signs in each role themselves.
const LIVE = process.env.DEMO_BASE_URL;

export default defineConfig({
  ...base,
  testDir: "./demo",
  outputDir: "./demo-output",
  reporter: "list",
  use: {
    ...base.use,
    baseURL: LIVE ?? base.use?.baseURL,
    // DEMO_DRY=1 checks the script headlessly without recording.
    headless: !!process.env.DEMO_DRY,
    viewport: { width: 1280, height: 720 },
    video: { mode: process.env.DEMO_DRY ? "off" : "on", size: { width: 1280, height: 720 } },
    actionTimeout: 30_000,
  },
  projects: [{ name: "demo" }],
  webServer: LIVE ? undefined : base.webServer,
});
