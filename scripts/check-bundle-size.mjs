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
const BUDGET_BYTES = 250 * 1024; // 250 KB brotli, total JS. Tighten later (D74).

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
