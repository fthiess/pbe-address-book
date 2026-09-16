#!/usr/bin/env tsx
/**
 * load-headshots — upload the prepared genesis headshots into an environment's
 * private image bucket, under the object keys a restore snapshot already names.
 *
 * Each primary PNG goes through `encodeHeadshot` — the SAME pipeline as a member's
 * own upload (prepare-uat-photos.ts set the precedent) — and lands as the 512²
 * headshot + 96² thumbnail WEBP pair at `headshots/<id>/<version>.webp` and
 * `thumbnails/<id>/<version>.webp`. The version is recomputed from the bytes and
 * must equal the snapshot's manifest entry, so a photo swapped after the snapshot
 * was built is a refusal, not a silently mismatched key.
 *
 * Order at cutover: convert → restore (which writes `hasHeadshot` + version) →
 * THIS → cold-start. A profile whose object is missing renders the placeholder
 * silhouette, so a partial run is visible, never broken; re-running is
 * idempotent (same bytes, same key, overwritten in place).
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   npm run genesis:headshots --workspace apps/api -- \
 *     --source <dir> --snapshot <genesis.json> --project <id> --bucket <name> \
 *     [--dry-run | --confirm <id>]
 */
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import type { ImageManifestEntry } from "../data/backup.js";
import { encodeHeadshot } from "../images/encode.js";
import { classifyHeadshotFiles, headshotVersionOf } from "./headshot-files.js";

function printHelp(): void {
  console.log(
    [
      "load-headshots — upload the genesis headshot pairs under the snapshot's object keys.",
      "",
      "Usage:",
      "  npm run genesis:headshots --workspace apps/api -- --source <dir> --snapshot <json>",
      "      --project <id> --bucket <name> (--dry-run | --confirm <id>)",
      "",
      "Options:",
      "  --source <dir>      Directory of <NNNN>-<First>-<Last>-<YYYY>.png primaries.",
      "  --snapshot <json>   The restore snapshot csv-to-snapshot wrote (its image manifest",
      "                      says which ids and versions to upload).",
      "  --project <id>      Target GCP project.",
      "  --bucket <name>     The environment's private image bucket (IMAGE_BUCKET).",
      "  --confirm <id>      Must equal --project. Required to upload anything.",
      "  --dry-run           Encode and check versions; upload nothing.",
      "  --help, -h          Show this help and exit.",
    ].join("\n"),
  );
}

function fail(message: string): never {
  console.error(`load-headshots: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}
const values: Record<string, string> = {};
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg === "--dry-run") {
    dryRun = true;
    continue;
  }
  if (!["--source", "--snapshot", "--project", "--bucket", "--confirm"].includes(arg)) {
    fail(`unknown argument ${arg} (see --help).`);
  }
  const value = args[++i];
  if (value === undefined || value.startsWith("--")) {
    fail(`${arg} needs a value.`);
  }
  values[arg.slice(2)] = value;
}
for (const required of ["source", "snapshot", "project", "bucket"]) {
  if (!values[required]) {
    fail(`--${required} is required.`);
  }
}
const projectId = values.project as string;
if (!dryRun && values.confirm !== projectId) {
  fail(`refusing to upload: pass --confirm ${projectId} (or --dry-run).`);
}

const snapshot = JSON.parse(await readFile(resolve(values.snapshot as string), "utf8")) as {
  images?: ImageManifestEntry[];
};
const manifest = snapshot.images ?? [];
if (manifest.length === 0) {
  fail("the snapshot has no image manifest entries — nothing to upload.");
}

const sourceDir = resolve(values.source as string);
const files = classifyHeadshotFiles(await readdir(sourceDir));
for (const name of files.unrecognised) {
  console.log(`  warning ${name}: not a primary or alternate headshot name; ignored.`);
}
if (files.duplicates.length > 0) {
  fail(`more than one primary headshot for #${files.duplicates.join(", #")} in ${sourceDir}.`);
}
const fileById = new Map<number, string>();
for (const [id, name] of files.primaries) {
  fileById.set(id, join(sourceDir, name));
}
const manifestIds = new Set(manifest.map((entry) => entry.id));
for (const id of fileById.keys()) {
  if (!manifestIds.has(id)) {
    console.log(
      `  warning #${id}: primary file present but not in the snapshot manifest — rebuild the snapshot to include it.`,
    );
  }
}

console.log(
  `==> ${manifest.length} manifest entry(ies); ${fileById.size} primary file(s) in ${sourceDir}`,
);
if (!dryRun) {
  initializeApp({ projectId });
}
const bucket = dryRun ? null : getStorage().bucket(values.bucket as string);
let uploaded = 0;
let bytesOut = 0;
const problems: string[] = [];
for (const entry of manifest) {
  const path = fileById.get(entry.id);
  if (!path) {
    problems.push(`#${entry.id}: no primary file for manifest version ${entry.version}`);
    continue;
  }
  const source = await readFile(path);
  const version = headshotVersionOf(source);
  if (version !== entry.version) {
    problems.push(
      `#${entry.id}: file hashes to ${version} but the snapshot says ${entry.version} — rebuild the snapshot`,
    );
    continue;
  }
  const encoded = await encodeHeadshot(source);
  bytesOut += encoded.headshot.byteLength + encoded.thumbnail.byteLength;
  if (bucket) {
    // Two independent objects: write them together, not one after the other.
    await Promise.all([
      bucket
        .file(entry.headshotKey)
        .save(encoded.headshot, { contentType: "image/webp", resumable: false }),
      bucket
        .file(entry.thumbnailKey)
        .save(encoded.thumbnail, { contentType: "image/webp", resumable: false }),
    ]);
  }
  uploaded++;
}
for (const problem of problems) {
  console.error(`  ERROR ${problem}`);
}
console.log(
  `==> ${dryRun ? "[dry-run] would upload" : "Uploaded"} ${uploaded} pair(s) (${(bytesOut / 1024).toFixed(0)} KB) to gs://${values.bucket}; ${problems.length} problem(s).`,
);
if (problems.length > 0) {
  process.exit(1);
}
