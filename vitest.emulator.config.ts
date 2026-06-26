import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromHere = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

/**
 * The emulator-backed integration suite (files named `*.emulator.test.ts`). Run
 * only under `npm run test:emulator`, which wraps it in `firebase emulators:exec`
 * so the Firestore emulator is up and `FIRESTORE_EMULATOR_HOST` is set. Kept
 * separate from the default unit suite so `npm test` never needs a JVM.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@pbe/shared": fromHere("./packages/shared/src/index.ts"),
      "@pbe/help-content": fromHere("./packages/help-content/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.emulator.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // The emulator suites share one Firestore instance (and some assert on a
    // whole-collection count), so they must not run in parallel against the same
    // database — one file completes, cleans up, then the next runs.
    fileParallelism: false,
  },
});
