#!/usr/bin/env tsx
/**
 * Assembles USER-MANUAL §10 — the per-control help reference — from the help
 * registry, which is the single source for both the in-page help and the manual
 * (D53). The manual promises in §11 that the two "cannot drift apart"; this
 * script plus the `assert:help-manual` gate check is what makes that promise
 * enforceable rather than aspirational (N118).
 *
 * The generated block is written **in place**, between the two marker comments,
 * so the manual stays one reviewable file (Forrest's call at the 6c-2 plan gate).
 *
 *   npm run docs:help            regenerate §10 in place
 *   npm run assert:help-manual   fail if regenerating would change the file
 *
 * It reads the registry's TypeScript source directly (via tsx), so it needs no
 * prior build and can run before `build:libs` in the gate and in CI.
 *
 * This file is I/O and process handling only; the rendering lives in
 * `lib/help-manual.ts` so the tests import that and `main()` here runs
 * unconditionally — a gate check must never be able to pass by not running.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

import { helpContent } from "../packages/help-content/src/registry.js";
import { MANUAL, renderReference, spliceIntoManual } from "./lib/help-manual.js";

const manual = readFileSync(MANUAL, "utf8");
const next = spliceIntoManual(manual, renderReference(helpContent));

if (argv.includes("--check")) {
  if (next !== manual) {
    console.error(
      `\n[help-manual] FAIL: ${MANUAL} §10 is out of step with the help registry.\nRegenerate it and commit the result:\n  npm run docs:help\n`,
    );
    exit(1);
  }
  console.log("[help-manual] OK: the manual's §10 reference matches the help registry.");
} else {
  writeFileSync(MANUAL, next);
  console.log(`[help-manual] Wrote the §10 reference into ${MANUAL} from the help registry.`);
}
