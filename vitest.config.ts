import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromHere = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    // Run tests against the workspace packages' source directly, so no prior
    // `tsc -b` build (or a stale dist) can affect a test run.
    alias: {
      "@pbe/shared": fromHere("./packages/shared/src/index.ts"),
      "@pbe/help-content": fromHere("./packages/help-content/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: [
      "packages/**/src/**/*.test.ts",
      "apps/api/src/**/*.test.ts",
      // The SPA's pure logic (grid model, comparators, lens reducers) is unit
      // tested here under the node environment; DOM-bearing component behaviour
      // is covered end-to-end by Playwright (e2e/).
      "apps/web/src/**/*.test.ts",
      "tools/fake-data/src/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.emulator.test.ts"],
  },
});
