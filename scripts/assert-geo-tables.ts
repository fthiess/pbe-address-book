/**
 * OFC-378 / D177: the committed proximity tables, the generated manifest that
 * names them, and the source tree must all agree.
 *
 * Fails if a table has been hand-edited (its content hash no longer matches its
 * filename), if the manifest names a file that is not there, if a stale table is
 * left in the served directory, if a row count drifts, or if any source file
 * imports a table as a module instead of fetching it.
 *
 * Needs no build and no network, so it sits in the pre-build cluster of the gate
 * and in `verify:fast`. Run via `npm run assert:geo-tables`; the logic and its
 * unit tests live in scripts/lib/geo-tables.ts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { exit } from "node:process";

import { GeoTablesError, checkTables, parseManifest } from "./lib/geo-tables.js";
import type { SourceFile } from "./lib/geo-tables.js";

const MANIFEST_PATH = "apps/web/src/generated/geoTables.ts";
const TABLE_DIR = "apps/web/public/geo";
/** Where a stray table import could plausibly be written. */
const SOURCE_ROOTS = ["apps/web/src", "apps/api/src", "packages"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

function fail(message: string): never {
  console.error(`\n[geo-tables] FAIL: ${message}\n`);
  return exit(1);
}

function readSourceFiles(): SourceFile[] {
  const files: SourceFile[] = [];
  for (const root of SOURCE_ROOTS) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        continue;
      }
      const path = join(entry.parentPath, entry.name);
      // Build output and dependencies are not source. Matched as whole path
      // segments — a file called `distance.ts` is source.
      if (/(^|[\\/])(node_modules|dist)[\\/]/.test(path)) {
        continue;
      }
      files.push({ path: path.replace(/\\/g, "/"), text: readFileSync(path, "utf8") });
    }
  }
  return files;
}

if (!existsSync(MANIFEST_PATH)) {
  fail(
    `${MANIFEST_PATH} is missing. Generate it with \`npm run build:tables --workspace tools/geo-data\`.`,
  );
}

const present = new Map<string, string>();
if (existsSync(TABLE_DIR)) {
  for (const name of readdirSync(TABLE_DIR)) {
    present.set(name, readFileSync(join(TABLE_DIR, name), "utf8"));
  }
}

try {
  const manifest = parseManifest(readFileSync(MANIFEST_PATH, "utf8"));
  const problems = checkTables({ manifest, present, sources: readSourceFiles() });
  if (problems.length > 0) {
    console.error(`\n[geo-tables] FAIL: ${problems.length} problem(s):`);
    for (const problem of problems) {
      console.error(`  ✗ ${problem}`);
    }
    console.error("");
    exit(1);
  }
  console.log(
    `[geo-tables] OK: ${manifest.zips.rows} ZIPs and ${manifest.cities.rows} cities, hashes match their filenames, nothing imports them.`,
  );
} catch (error) {
  if (error instanceof GeoTablesError) {
    fail(error.message);
  }
  throw error;
}
