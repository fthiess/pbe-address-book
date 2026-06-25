#!/usr/bin/env node
/**
 * D108 layer 3 — the CI/build assertion.
 *
 * Bundles the API's PRODUCTION entry point (`apps/api/src/index.ts`) exactly as
 * the production build does, then fails if any trace of the `DevIdentityProvider`
 * appears in the output. Layer 1 (never importing the dev provider from the
 * production entry) is what makes this pass; this script is the guard that makes
 * a regression of layer 1 fail the build loudly rather than ship a total-auth-
 * bypass seam into production.
 *
 * Run via `npm run assert:no-dev-provider`.
 */
import { build } from "esbuild";

const PROD_ENTRY = "apps/api/src/index.ts";

// Strings that must never appear in the production bundle. The sentinel is a
// string literal (survives bundling even if comments are stripped); the others
// are belt-and-suspenders on the module/identifier names.
const FORBIDDEN = [
  "__BOOK_DEV_IDENTITY_PROVIDER_PRESENT__",
  "DevIdentityProvider",
  "dev-provider",
  "registerDevRoutes",
];

const result = await build({
  entryPoints: [PROD_ENTRY],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  write: false,
  logLevel: "silent",
});

const code = result.outputFiles.map((file) => file.text).join("\n");
const hits = FORBIDDEN.filter((needle) => code.includes(needle));

if (hits.length > 0) {
  console.error(
    `\n[D108] FAIL: the production bundle (${PROD_ENTRY}) contains dev-identity-provider traces: ${hits.join(", ")}.\nThe DevIdentityProvider must be unreachable from the production entry point. Check that index.ts imports no dev-* module (DECISIONS D108).\n`,
  );
  process.exit(1);
}

console.log(
  `[D108] OK: the production bundle is free of DevIdentityProvider code (checked ${FORBIDDEN.length} markers).`,
);
