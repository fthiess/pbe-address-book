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
 * `full-name-backfill.ts` for the rule and its tests. Each write is conditional on
 * the document's `updateTime` at the read (`lastUpdateTime` precondition), so a
 * brother who fills the field in between the read and the write is a skipped
 * FAILED_PRECONDITION — reported, never overwritten. Re-running is idempotent.
 *
 * ⚠ THIS IS A SECOND OUT-OF-BAND WRITER, THE ONE D100 SAID WOULD NOT EXIST — the
 * exception D181 records. ⚠ INVISIBLE UNTIL A COLD START, AND EDITS CONFLICT UNTIL
 * THEN. Book serves profiles from an in-memory cache hydrated only on cold start
 * (the Firestore listener that would converge an out-of-band write is deferred,
 * D83), and every edit carries the document's `updateTime` as its optimistic-
 * concurrency token (D25). Writing behind the running instance means (a) the new
 * names do not show until the instance is replaced, and (b) an edit to a
 * backfilled record in that window fails its precondition (412) because the cache
 * still holds the pre-backfill token. So: run this, then IMMEDIATELY force a new
 * revision (same image; the recipe is in infra/README.md "Force a cold start").
 * Same model as the restore, minus the hard-down: the blast radius is one optional
 * field and a few minutes of 412s, not the roster.
 *
 * UNDO. BEFORE the first write the run records `<out>/backfill-full-name-
 * <timestamp>.json` listing every document id it intends to change, and rewrites
 * it afterwards with what was actually written and what was skipped. Clearing
 * `fullLegalName` on the listed ids reverts the run; if the run died mid-way the
 * file is a superset, which is still a safe undo (an unwritten id is still blank).
 * The genesis values and any brother edits were never touched, so they are not in
 * the list.
 *
 * Usage (from the repo root, after `gcloud auth application-default login` —
 * `--dry-run` reads the live collection too, so it needs the same credentials):
 *   npm run backfill:full-name --workspace apps/api -- --project <id> --dry-run
 *   npm run backfill:full-name --workspace apps/api -- --project <id> --confirm <id>
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { initializeApp } from "firebase-admin/app";
import { type Timestamp, getFirestore } from "firebase-admin/firestore";
import { type FullNameSource, planFullNameBackfill } from "./full-name-backfill.js";

const DEFAULT_OUT_DIR = "restore-artifacts";
/** gRPC FAILED_PRECONDITION: the document changed since the read. */
const GRPC_FAILED_PRECONDITION = 9;

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
      "  --dry-run           Read the live collection and plan; write nothing (same credentials).",
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
  snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as FullNameSource,
    token: doc.updateTime as Timestamp,
  })),
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

// The undo list goes down BEFORE the first write, as the intended set; it is
// rewritten below with the actual outcome. A crash between the two leaves a
// superset, which is still a safe undo.
const outDir = resolve(values.out ?? DEFAULT_OUT_DIR);
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const artifact = resolve(outDir, `backfill-full-name-${stamp}.json`);
const intended = plan.updates.map((u) => u.docId);
await writeFile(
  artifact,
  `${JSON.stringify({ projectId, status: "in-progress", intended }, null, 2)}\n`,
);
console.log(`==> Undo list (intended ids) written to ${artifact}`);

// BulkWriter: per-document writes, each conditional on the read-time updateTime.
// A FAILED_PRECONDITION is a record someone edited since the read — skipped and
// reported, not retried. Anything else is retried a bounded number of times
// (BulkWriter's default handler is replaced by ours) and then reported as failed.
const written: string[] = [];
const skipped: string[] = [];
const failed: string[] = [];
const writer = db.bulkWriter();
writer.onWriteError((error) => {
  if (error.code === GRPC_FAILED_PRECONDITION) {
    skipped.push(error.documentRef.id);
    return false;
  }
  if (error.failedAttempts < 10) {
    return true;
  }
  failed.push(`${error.documentRef.id}: ${error.message}`);
  return false;
});
for (const update of plan.updates) {
  // `update()` requires the document to exist and touches only the named field.
  writer
    .update(db.collection("profiles").doc(update.docId), "fullLegalName", update.fullLegalName, {
      lastUpdateTime: update.token,
    })
    .then(() => {
      written.push(update.docId);
    })
    // Every rejection has already been routed through onWriteError above.
    .catch(() => undefined);
}
await writer.close();

await writeFile(
  artifact,
  `${JSON.stringify(
    { projectId, status: "done", writtenAt: new Date().toISOString(), written, skipped, failed },
    null,
    2,
  )}\n`,
);
for (const id of skipped) {
  console.log(`  skipped #${id}: edited since the read; left as is.`);
}
for (const problem of failed) {
  console.error(`  ERROR #${problem}`);
}
console.log(
  `==> Wrote ${written.length} Full name(s); ${skipped.length} skipped (edited since the read); ${failed.length} failed. Outcome recorded in ${artifact}`,
);
console.log(
  "==> NOW force a cold start of pbe-book-api (infra/README.md) — until then the change is invisible and edits to these records get 412.",
);
if (failed.length > 0) {
  process.exit(1);
}
