import { defineConfig, devices } from "@playwright/test";

/**
 * The documentation-screenshot harness (N119), kept in its own config so it is
 * **not** part of `npm run e2e` or the CI gate: it writes files into
 * `docs/images/` rather than asserting anything, and regenerating the manual's
 * illustrations is a deliberate act, not something a test run should do behind
 * your back.
 *
 *   npm run docs:screenshots
 *
 * It reuses the e2e harness's approach — the real production bundle, served by
 * `vite preview`, driven against network-mocked `/api/*` fixtures — so the shots
 * are of the app that actually ships, are reproducible on any machine, and can
 * never contain real member data (D-public-repo rule: the roster comes from
 * `tools/fake-data`, whose ids are all > #5000 and whose emails are all
 * `example.test`).
 *
 * Single worker and no retries: the shots are captured in sequence into fixed
 * filenames, so parallelism would only invite interleaved writes.
 */
export default defineConfig({
  testDir: "./tools/screenshots",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    // The manual's illustrations are dark-mode throughout (Forrest's call at the
    // 6c-2 plan gate — an aesthetic preference, not a technical one). The app
    // reads its own `book-theme` key, set per-page in the harness; this only
    // keeps the OS-preference fallback pointing the same way.
    colorScheme: "dark",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "npm run build:web && npm run preview --workspace apps/web -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
