#!/usr/bin/env node
/**
 * D74 — the CI bundle-size budget. First paint on a slow link is dominated by
 * bytes shipped, and a meaningful share of the brotherhood is on slow
 * connections (D73–D76), so the build fails if the SPA's shipped JavaScript
 * grows past a set ceiling. We measure brotli size (what Firebase Hosting
 * actually serves) of every JS chunk in the built bundle.
 *
 * The budget is deliberately generous in Phase 0 (the app is a placeholder)
 * and is meant to be tightened as the real surfaces land (Phase 7 verifies
 * delivery at scale). Run via `npm run check:bundle-size`.
 *
 * ⚠ **There is no code-splitting to account for, by decision (D157).** D74's
 * code-splitting clause was measured across four configurations in Stage 1.3 and
 * deliberately not implemented: only 21% of the critical path is page-exclusive,
 * so the best available split was worth 6.2 KB, and the Profile page cannot be
 * split at all because newsletter deep links make it a co-equal entry point.
 * A separate critical-path assertion was considered alongside it and dropped with
 * it. If a future session is tempted to "finish" D74, read D157 first — the
 * measurement is there so nobody spends the hour twice.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";

const ASSETS_DIR = "apps/web/dist/assets";
// 270 KB brotli, total JS (D74).
//
// Raised from 250 KB in 7a-2, attributable to one change (the argument in
// OFC-286: every move of this number should name the code that caused it).
// Mixpanel's core build takes the measured total from 223.8 KB to 254.5 KB — so
// the old ceiling was not merely tight, it was exceeded. 270 KB restores roughly
// the working margin the 250 KB figure used to give.
//
// Note this script measures a **token-less** build (CI never sets
// BOOK_MIXPANEL_TOKEN), in which the minifier dead-code-eliminates the body of
// `initAnalytics()`. A token-bearing staging build is ~0.6 KB larger (255.1 KB
// measured). The library itself is in both, because the import is static, so the
// figure tracks the real thing closely — but it is a floor, not an exact match.
//
// The 250 KB was an arbitrary forcing function: a number low enough to require a
// conversation before the bundle grew again. It did its job (Forrest's call, 7a-2).
//
// This total is a **sum over all chunks**, so it cannot see the critical path and
// cannot score a change to how the bundle is divided. The place to re-derive it
// from evidence is the Lighthouse baseline (N134) plus the four-configuration
// decomposition in D157, which measures what is actually on the critical path
// (223.3 KB of this 256.5 KB total, of which only 21% is page-exclusive).
const BUDGET_BYTES = 270 * 1024;

let files;
try {
  files = readdirSync(ASSETS_DIR).filter((name) => name.endsWith(".js"));
} catch {
  console.error(
    `[bundle-size] FAIL: ${ASSETS_DIR} not found. Build the web app first (npm run build:web).`,
  );
  process.exit(1);
}

if (files.length === 0) {
  console.error(`[bundle-size] FAIL: no .js chunks found in ${ASSETS_DIR}.`);
  process.exit(1);
}

let total = 0;
const rows = [];
for (const file of files) {
  const raw = readFileSync(join(ASSETS_DIR, file));
  const brotli = brotliCompressSync(raw).length;
  total += brotli;
  rows.push({ file, brotli });
}

rows.sort((a, b) => b.brotli - a.brotli);
for (const { file, brotli } of rows) {
  console.log(`  ${(brotli / 1024).toFixed(1).padStart(7)} KB  ${file}`);
}

const totalKb = (total / 1024).toFixed(1);
const budgetKb = (BUDGET_BYTES / 1024).toFixed(0);

if (total > BUDGET_BYTES) {
  console.error(
    `\n[bundle-size] FAIL: shipped JS is ${totalKb} KB brotli, over the ${budgetKb} KB budget (D74).`,
  );
  process.exit(1);
}

console.log(
  `\n[bundle-size] OK: shipped JS is ${totalKb} KB brotli, within the ${budgetKb} KB budget (D74).`,
);
