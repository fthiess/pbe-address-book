#!/usr/bin/env tsx
/**
 * csv-to-snapshot — the I/O shell of the genesis conversion (OFC-341). Reads the
 * merged roster CSV (and optionally the prepared headshot directory), runs
 * `convertGenesisCsv`, prints the report, and writes a version-2 restore snapshot
 * that `restore.ts` loads with `--file`. Writes NOTHING to any cloud.
 *
 * The headshot directory is read only to learn WHICH ids have a photo and to
 * mint each `headshotVersion` (a content hash — `load-headshots.ts` recomputes it
 * from the same bytes, so the two tools agree without sharing state). The photo
 * bytes themselves are uploaded by `load-headshots.ts` after the restore.
 *
 * Usage (from the repo root):
 *   npm run genesis:convert --workspace apps/api -- \
 *     --csv <roster.csv> --out ./restore-artifacts/genesis.json \
 *     [--headshots <dir>] [--admin <id> ...] [--dry-run]
 *
 * ⚠ The CSV and the output are REAL MEMBER PII. Keep both under the gitignored
 * `restore-artifacts/` (or anywhere outside the tree); the report prints ids and
 * counts only, never names or addresses.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildBackupSnapshot } from "../data/backup.js";
import { type ConversionIssue, convertGenesisCsv } from "./genesis-convert.js";
import { headshotVersionOf, primaryHeadshotId } from "./headshot-files.js";

function printHelp(): void {
  console.log(
    [
      "csv-to-snapshot — convert the merged genesis roster CSV into a restore snapshot.",
      "",
      "Usage:",
      "  npm run genesis:convert --workspace apps/api -- --csv <path> --out <path.json>",
      "      [--headshots <dir>] [--admin <id>]... [--dry-run]",
      "",
      "Options:",
      "  --csv <path>        The merged roster CSV (required).",
      "  --out <path>        Where the snapshot JSON is written (required unless --dry-run).",
      "  --headshots <dir>   Directory of <NNNN>-<First>-<Last>-<YYYY>.png primaries; each",
      "                      sets hasHeadshot + a content-hash headshotVersion.",
      "  --admin <id>        Constitution ID to load with role=admin (repeatable). Everyone",
      "                      else is a brother by omission (OFC-238).",
      "  --dry-run           Convert and report; write nothing.",
      "  --help, -h          Show this help and exit.",
    ].join("\n"),
  );
}

function fail(message: string): never {
  console.error(`csv-to-snapshot: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}
let csvPath: string | undefined;
let outPath: string | undefined;
let headshotsDir: string | undefined;
const adminIds: number[] = [];
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const next = () => {
    const value = args[++i];
    if (value === undefined || value.startsWith("--")) {
      fail(`${arg} needs a value.`);
    }
    return value;
  };
  switch (arg) {
    case "--csv":
      csvPath = next();
      break;
    case "--out":
      outPath = next();
      break;
    case "--headshots":
      headshotsDir = next();
      break;
    case "--admin": {
      const id = Number(next());
      if (!Number.isInteger(id) || id <= 0) {
        fail("--admin needs a positive integer id.");
      }
      adminIds.push(id);
      break;
    }
    case "--dry-run":
      dryRun = true;
      break;
    default:
      fail(`unknown argument ${arg} (see --help).`);
  }
}
if (!csvPath) {
  fail("--csv is required.");
}
if (!dryRun && !outPath) {
  fail("--out is required unless --dry-run.");
}

const headshotVersions = new Map<number, string>();
if (headshotsDir) {
  const dir = resolve(headshotsDir);
  for (const name of await readdir(dir)) {
    const id = primaryHeadshotId(name);
    if (id === null) {
      continue;
    }
    if (headshotVersions.has(id)) {
      fail(`two primary headshots for #${id} in ${dir}.`);
    }
    headshotVersions.set(id, headshotVersionOf(await readFile(join(dir, name))));
  }
  console.log(`==> ${headshotVersions.size} primary headshot(s) found in ${dir}`);
}

const now = new Date();
const text = await readFile(resolve(csvPath), "utf8");
const result = convertGenesisCsv(text, {
  now: now.toISOString(),
  adminIds,
  headshotVersions,
});

const render = (issue: ConversionIssue) =>
  `  ${issue.severity === "error" ? "ERROR  " : "warning"} #${issue.id} ${issue.field}: ${issue.message}`;
const errors = result.issues.filter((i) => i.severity === "error");
const warnings = result.issues.filter((i) => i.severity === "warning");
for (const issue of warnings) {
  console.log(render(issue));
}
for (const issue of errors) {
  console.error(render(issue));
}
const s = result.stats;
console.log(
  `==> ${s.rows} row(s): ${s.deceased} deceased, ${s.debrothered} de-brothered, ${s.withEmail} with email, ` +
    `${s.withAddress} with address, ${s.withHeadshot} with headshot, ${s.admins} admin(s); ` +
    `${warnings.length} warning(s), ${errors.length} error(s).`,
);
if (errors.length > 0) {
  fail("conversion has errors. Nothing was written.");
}
if (dryRun) {
  console.log("[dry-run] No snapshot written.");
  process.exit(0);
}
const snapshot = buildBackupSnapshot(result.collections, now);
const out = resolve(outPath as string);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  `==> Snapshot written to ${out} (${snapshot.collections.profiles.length} profiles, ${snapshot.images.length} image manifest entries). ⚠ Contains real member PII.`,
);
