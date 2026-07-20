#!/usr/bin/env node
/**
 * D74 — the CI bundle-size budget. First paint on a slow link is dominated by
 * bytes shipped, and a meaningful share of the brotherhood is on slow
 * connections (D73–D76), so the build fails if the SPA's shipped JavaScript
 * grows past a set ceiling. We measure brotli size (what Firebase Hosting
 * actually serves) of every JS chunk in the built bundle.
 *
 * The budget is deliberately generous in Phase 0 (the app is a placeholder)
 * and is meant to be tightened as the real surfaces and code-splitting land
 * (Phase 7 verifies delivery at scale). Run via `npm run check:bundle-size`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";

const ASSETS_DIR = "apps/web/dist/assets";
// 270 KB brotli, total JS (D74).
//
// Raised from 250 KB in 7a-2, attributable to one change (the argument in
// OFC-286: every move of this number should name the code that caused it).
// Mixpanel's core build adds 30.5 KB, taking the measured total from 223.8 KB to
// 254.3 KB — so the old ceiling was not merely tight, it was exceeded. 270 KB
// restores roughly the working margin the 250 KB figure used to give.
//
// The 250 KB was an arbitrary forcing function: a number low enough to require a
// conversation before the bundle grew again. It did its job (Forrest's call, this
// session). Phase 7b's Lighthouse baseline (OFC-286) measures the critical path
// this byte count can't see, and is the right place to re-derive the ceiling from
// evidence rather than from feel.
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
