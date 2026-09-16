#!/usr/bin/env tsx
/**
 * backfill-full-name — give every stored profile with a blank `fullLegalName`
 * its first/middle/last join (OFC-429 / D181).
 *
 * WHY. The genesis converter's first cut stored a Full name only where the source
 * value differed from the join (N178), so ~1,150 of the 1,480 loaded brothers show
 * a blank Full name in the Directory, the edit form and the CSV export. That reads
 * as missing data. This one-off fills the gap in place; the converter now carries
 * the value verbatim so a future genesis load never needs it again.
 *
 * WHAT IT NEVER TOUCHES. A record with any non-blank `fullLegalName` — a genesis
 * suffix, or a value a brother typed since launch — is left exactly as is. No other
 * field is written: not `lastModified`, not verification. See the planner in
 * `full-name-backfill.ts` for the rule and its tests.
 *
 * ⚠ INVISIBLE UNTIL A COLD START, AND EDITS CONFLICT UNTIL THEN. Book serves
 * profiles from an in-memory cache hydrated only on cold start (no Firestore
 * listener, D85), and every edit carries the document's `updateTime` as its
 * optimistic-concurrency token (D25). Writing behind the running instance means
 * (a) the new names do not show until the instance is replaced, and (b) an edit
 * to a backfilled record in that window fails its precondition (412) because the
 * cache still holds the pre-backfill token. So: run this, then IMMEDIATELY force a
 * new revision (same image; the recipe is in infra/README.md "Force a cold start").
 * Same model as the restore, minus the hard-down: the blast radius is one optional
 * field and a few minutes of 412s, not the roster.
 *
 * UNDO. The run writes `<out>/backfill-full-name-<timestamp>.json` listing every
 * document id it changed; clearing `fullLegalName` on exactly those ids reverts it
 * (the 335 genesis values and any brother edits were never touched, so they are
 * not in the list).
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   npm run backfill:full-name --workspace apps/api -- --project <id> --dry-run
 *   npm run backfill:full-name --workspace apps/api -- --project <id> --confirm <id>
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { type FullNameSource, planFullNameBackfill } from "./full-name-backfill.js";

/** Firestore's per-batch write ceiling. */
const BATCH_LIMIT = 500;
const DEFAULT_OUT_DIR = "restore-artifacts";

function printHelp(): void {
  console.log(
    [
      "backfill-full-name — set fullLegalName to the first/middle/last join wherever it is blank.",
      "",
      "Usage:",
      "  npm run backfill:full-name --workspace apps/api -- --project <id> (--dry-run | --confirm <id>)",
      "",
      "Options:",
      "  --project <id>      Target GCP project.",
      "  --confirm <id>      Must equal --project. Required to write anything.",
      "  --dry-run           Read and plan; write nothing.",
      "  --out <dir>         Where the changed-ids artifact goes (default restore-artifacts/).",
      "  --help, -h          Show this help and exit.",
      "",
      "⚠ Force a cold start of the API right after a real run (infra/README.md).",
    ].join("\n"),
  );
}

function fail(message: string): never {
  console.error(`backfill-full-name: ${message}`);
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
  if (!["--project", "--confirm", "--out"].includes(arg)) {
    fail(`unknown argument ${arg} (see --help).`);
  }
  const value = args[++i];
  if (value === undefined || value.startsWith("--")) {
    fail(`${arg} needs a value.`);
  }
  values[arg.slice(2)] = value;
}
if (!values.project) {
  fail("--project is required.");
}
const projectId = values.project as string;
if (!dryRun && values.confirm !== projectId) {
  fail(`refusing to write: pass --confirm ${projectId} (or --dry-run).`);
}

initializeApp({ projectId });
const db = getFirestore();
const snapshot = await db.collection("profiles").get();
const plan = planFullNameBackfill(
  snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() as FullNameSource })),
);

console.log(
  `==> ${snapshot.size} profile(s) in ${projectId}: ${plan.alreadySet} already have a Full name, ${plan.updates.length} blank, ${plan.unnamed.length} unnamed.`,
);
for (const id of plan.unnamed) {
  console.log(`  warning #${id}: no first or last name; skipped.`);
}
if (plan.updates.length === 0) {
  console.log("==> Nothing to do.");
  process.exit(0);
}

if (dryRun) {
  console.log(`==> [dry-run] would write ${plan.updates.length} Full name(s); wrote nothing.`);
  process.exit(0);
}

let written = 0;
for (let start = 0; start < plan.updates.length; start += BATCH_LIMIT) {
  const batch = db.batch();
  const chunk = plan.updates.slice(start, start + BATCH_LIMIT);
  for (const update of chunk) {
    // `update()` requires the document to exist and touches only the named field.
    batch.update(db.collection("profiles").doc(update.docId), {
      fullLegalName: update.fullLegalName,
    });
  }
  await batch.commit();
  written += chunk.length;
  console.log(`  wrote ${written}/${plan.updates.length}`);
}

const outDir = resolve(values.out ?? DEFAULT_OUT_DIR);
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const artifact = resolve(outDir, `backfill-full-name-${stamp}.json`);
await writeFile(
  artifact,
  `${JSON.stringify({ projectId, writtenAt: new Date().toISOString(), docIds: plan.updates.map((u) => u.docId) }, null, 2)}\n`,
);
console.log(`==> Wrote ${written} Full name(s). Changed ids recorded in ${artifact}`);
console.log(
  "==> NOW force a cold start of pbe-book-api (infra/README.md) — until then the change is invisible and edits to these records get 412.",
);
