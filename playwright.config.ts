import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright is the committed end-to-end + accessibility harness (DECISIONS
 * D65/D67). In Phase 0 it runs one smoke path plus the axe-core a11y scan
 * against the built SPA. The suite grows page by page through Phases 3–5 and is
 * completed into a full regression net in Phase 7.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build the SPA and serve the production bundle, so E2E exercises what ships.
    command:
      "npm run build:web && npm run preview --workspace apps/web -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
