#!/usr/bin/env node
/**
 * D138's privacy guard, made structural.
 *
 * Book must never ship Mixpanel's session-replay recorder. Replay captures the
 * rendered DOM, so a single recording of a Directory page would send other
 * brothers' names, emails, phone numbers and postal addresses to Mixpanel — routing
 * protected data around the server-side per-role projection (D5/D82) that the whole
 * design rests on. The newsletter side runs `record_sessions_percent: 100`, which is
 * unobjectionable on public article pages and must not be copied here.
 *
 * Three things keep it out, and this script is the third:
 *   1. `analyticsClient.ts` imports Mixpanel's **core** loader, which carries no
 *      recorder payload;
 *   2. `init()` passes `record_sessions_percent: 0` and `autocapture: false`;
 *   3. this assertion fails the build if the recorder ever reappears in the bundle —
 *      via a dependency upgrade, a "harmonize with the newsletter" refactor, or an
 *      innocent switch back to the default `mixpanel-browser` entry point.
 *
 * Modelled on `assert-no-dev-provider.mjs` (D108 layer 3). Run via
 * `npm run assert:no-session-replay`, after the web build.
 *
 * **Match on the recorder implementation, not on config keys.** The core build does
 * still contain the recorder *plumbing* — a `recorderManager`, and the strings
 * `record_sessions_percent` / `start_session_recording` — with no payload behind it.
 * Asserting on those would fail against a correct bundle; asserting on the rrweb
 * machinery is what actually distinguishes "can record" from "cannot".
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ASSETS_DIR = "apps/web/dist/assets";

// Markers of the rrweb-based recorder itself. Present in `mixpanel-browser`'s
// default entry point and in `mixpanel-with-async-recorder`; absent from the core
// build this app imports.
const FORBIDDEN = ["rrweb", "rrdom", "MixpanelRecorder", "@mixpanel/rrweb"];

let files;
try {
  files = readdirSync(ASSETS_DIR).filter((name) => name.endsWith(".js"));
} catch {
  console.error(
    `\n[D138] FAIL: ${ASSETS_DIR} not found. Build the SPA first (npm run build:web).\n`,
  );
  process.exit(1);
}

if (files.length === 0) {
  console.error(`\n[D138] FAIL: no JS chunks in ${ASSETS_DIR}; the build looks empty.\n`);
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const code = readFileSync(join(ASSETS_DIR, file), "utf8");
  for (const needle of FORBIDDEN) {
    if (code.includes(needle)) {
      hits.push(`${needle} (in ${file})`);
    }
  }
}

if (hits.length > 0) {
  console.error(
    `\n[D138] FAIL: the SPA bundle contains Mixpanel session-replay code: ${hits.join(", ")}.\nReplay would ship other brothers' rendered PII to Mixpanel, around the D5/D82 projection.\nCheck that lib/analyticsClient.ts still imports 'mixpanel-browser/src/loaders/loader-module-core'\nand not the package's default entry point (DECISIONS D138).\n`,
  );
  process.exit(1);
}

console.log(
  `[D138] OK: no session-replay recorder in the SPA bundle (checked ${FORBIDDEN.length} markers across ${files.length} chunk(s)).`,
);
