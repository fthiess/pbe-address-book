#!/usr/bin/env node
/**
 * The design token layer has a single canonical source — the frozen
 * `docs/initial-build/visual-design/tokens.css` (VISUAL-DESIGN-BRIEF). The web
 * app vendors a copy so Vite can bundle it. This guard fails the build if the
 * vendored copy drifts from the canonical one, so the brand palette stays
 * single-sourced (D29). Re-copy the canonical file to fix a drift.
 */
import { readFileSync } from "node:fs";

const CANONICAL = "docs/initial-build/visual-design/tokens.css";
const VENDORED = "apps/web/src/styles/tokens.css";

const canonical = readFileSync(CANONICAL, "utf8");
const vendored = readFileSync(VENDORED, "utf8");

if (canonical !== vendored) {
  console.error(
    `\n[tokens] FAIL: ${VENDORED} has drifted from the canonical ${CANONICAL}.\n` +
      `Re-copy the canonical file:\n  cp "${CANONICAL}" "${VENDORED}"\n`,
  );
  process.exit(1);
}

console.log("[tokens] OK: the vendored token layer matches the canonical visual-design source.");
