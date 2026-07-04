#!/usr/bin/env node
/**
 * The Content-Security-Policy in `firebase.json` pins `script-src` to `'self'`
 * plus a **SHA-256 hash of each inline `<script>`** in `apps/web/index.html` —
 * the two no-FOUC setters (theme + font size) that must run before React paints
 * (D30/§5.3). That is what lets the CSP forbid inline scripts wholesale (no
 * `'unsafe-inline'`) while still allowing those two (D107/OFC-148).
 *
 * The hazard: those hashes are byte-exact, so any edit to an inline script —
 * even whitespace — silently invalidates the CSP and the browser then **blocks**
 * the setter, breaking dark mode / large fonts for exactly the audience they
 * serve. This guard recomputes the hashes from `index.html` and fails the build
 * if `firebase.json` does not carry every one, turning a silent production CSP
 * break into a loud CI failure. To fix a drift, copy the printed hashes into the
 * `Content-Security-Policy` `script-src` in `firebase.json`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const INDEX_HTML = "apps/web/index.html";
const FIREBASE_JSON = "firebase.json";

const html = readFileSync(INDEX_HTML, "utf8");
const firebase = readFileSync(FIREBASE_JSON, "utf8");

// The inline scripts are exactly those <script>…</script> with no attributes
// (the bundle entry is <script type="module" src=…>, which this does not match).
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

if (inlineScripts.length === 0) {
  console.error(
    `[csp] FAIL: found no inline <script> in ${INDEX_HTML} — the matcher may be stale.`,
  );
  process.exit(1);
}

const expected = inlineScripts.map(
  (body) => `sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`,
);

const missing = expected.filter((hash) => !firebase.includes(`'${hash}'`));

if (missing.length > 0) {
  const list = missing.map((h) => `  '${h}'`).join("\n");
  console.error(
    `\n[csp] FAIL: ${FIREBASE_JSON}'s Content-Security-Policy is missing a hash for ${missing.length} inline script(s) in ${INDEX_HTML}.\nThe no-FOUC theme/font setters would be blocked in the browser.\nPut these exact hash(es) in the script-src directive:\n${list}\n`,
  );
  process.exit(1);
}

console.log(`[csp] OK: firebase.json pins all ${expected.length} inline-script hash(es).`);
