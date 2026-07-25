#!/usr/bin/env tsx
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { AuditLog } from "../audit/audit-log.js";
import { planGhostAudit } from "../audit/ghost-audit.js";
import { GcsBackupStore } from "../data/backup-store.js";
import { FirestoreBackupSource, buildBackupSnapshot } from "../data/backup.js";
import {
  FirestoreRestoreTarget,
  executeRestore,
  planRestore,
  readCurrentDocIds,
} from "../data/restore-executor.js";
import {
  hydrateProfiles,
  parseSnapshot,
  privilegedRoster,
  rosterDelta,
  validateSnapshot,
} from "../data/restore.js";
import { GhostAdminReader } from "../identity/ghost-reader.js";
import {
  LATEST_OBJECT,
  buildRestoreAuditEntry,
  isMaintenancePage,
  parseArgs,
  renderRosterSummary,
  renderValidationReport,
} from "./restore-support.js";

/**
 * **The offline restore** (D101; 7b-3) — Book's most destructive operation, and
 * the only bulk write into it that exists (D100).
 *
 * THE MODEL. Book goes hard-down (`infra/maintenance-on.sh`, D118), this tool
 * replaces the three durable collections from a snapshot, and Book restarts and
 * cold-hydrates its cache and email index from the restored data (D85/D97). Because
 * the system is down during the replace there is no live second writer, which is
 * what dissolves the in-flight-coherence and uniqueness problems an online restore
 * would have had. **The restart is not optional and not automatic**: the cache
 * hydrates only on cold start — there is no Firestore listener — so until the
 * instance is replaced, Book keeps serving the data that was there before, and
 * would write against it.
 *
 * WHAT IT REFUSES. The snapshot must pass D101's structural validation — id
 * uniqueness, email uniqueness across the one primary+alternate namespace, big-
 * brother reference integrity, and cycle freedom — before a single document is
 * touched. Field-level edit rules stay bypassed (D63: "be exactly this snapshot",
 * not "merge corrections"), and **roles restore verbatim, ungated** (D101, Forrest's
 * call: gating them is theater against an actor who already holds restore
 * privilege). What replaces prevention is visibility — see the forensic entry below.
 *
 * WHY IT LIVES HERE AND NOT IN `tools/`. It needs the backup types, the cache's
 * hydration normalization, the audit shape and the reconciliation planner, all of
 * which are `apps/api` internals; nothing under `tools/` imports across workspaces.
 * Nothing in the server bundle imports this file, so esbuild never sees it — it is
 * operator tooling that happens to share the API's module graph, in the spirit of
 * D100's "whole-database work is external operator tooling".
 *
 * Usage (from the repo root, authenticated with `gcloud auth application-default
 * login` and, for the audit delivery, `gcloud auth login`):
 *
 *   npm run restore --workspace apps/api -- --object latest --project <id> --dry-run
 *   npm run restore --workspace apps/api -- --object latest --project <id> --confirm <id>
 */

const execFileAsync = promisify(execFile);

/**
 * The Cloud Logging log name the forensic entry is written to (D101/7b-3, Forrest's
 * call at the plan gate). The entry cannot ride Book's own stdout stream: the
 * restore runs with Book *down*, from an operator's machine, and the audit sink
 * routes on `resource.type="cloud_run_revision"` — a line printed here would never
 * reach the 3-month retention bucket (P16/D144). So the tool writes it to Cloud
 * Logging itself, under its own log name, with the same `logType: "audit"` label,
 * and `infra/provision-observability.sh` routes that log name into the same bucket.
 * Writing it as the *tool* rather than forging the service's resource keeps the
 * provenance honest: the entry says an operator did this, because one did.
 */
const RESTORE_LOG_NAME = "book-restore";

function printHelp(): void {
  console.log(
    [
      "restore — replace Book's three durable collections from a backup snapshot (D101).",
      "",
      "  THIS REPLACES THE DIRECTORY. Take Book down first (infra/maintenance-on.sh),",
      "  and force a Cloud Run cold start afterwards or the cache will keep serving the",
      "  old data (there is no Firestore listener).",
      "",
      "Usage:",
      "  npm run restore --workspace apps/api -- --object latest --project <id> [--dry-run]",
      "  npm run restore --workspace apps/api -- --file <path.json> --project <id> --confirm <id>",
      "",
      "Snapshot source (exactly one):",
      "  --file <path>        A snapshot JSON on disk (envelope version 1 or 2).",
      `  --object <name>      An object in the backup bucket; "${LATEST_OBJECT}" picks the newest.`,
      "",
      "Options:",
      "  --project <id>       Target project (default: GOOGLE_CLOUD_PROJECT).",
      "  --confirm <id>       Must equal the target project id. Required to write anything.",
      "  --bucket <name>      Backup bucket (default: <project>-backups).",
      "  --out-dir <path>     Where artifacts are written (default: ./restore-artifacts).",
      "  --hosting-url <url>  Origin probed for the maintenance page (default: https://<project>.web.app).",
      "  --dry-run            Validate and print the plan; write nothing, anywhere.",
      "  --force              Skip the maintenance-page pre-flight (ephemeral environments).",
      "  --allow-emulator     Permit running against FIRESTORE_EMULATOR_HOST.",
      "  --skip-ghost-audit   Do not run the post-restore Ghost reconciliation.",
      "  --no-safety-snapshot Do not archive the current data first (also loses the roster delta).",
      "  --help,-h            Show this help and exit.",
      "",
      "Artifacts (they contain REAL MEMBER PII — the out-dir is gitignored, keep it off",
      "shared storage): the pre-restore safety snapshot, the restore report, the forensic",
      "audit entry, and the Ghost discrepancy report.",
    ].join("\n"),
  );
}

function fail(message: string): never {
  console.error(`restore: ${message}`);
  process.exit(1);
}

/** Read the snapshot text from disk or from the backup bucket. */
async function loadSnapshotText(
  file: string | null,
  object: string | null,
  bucket: string,
): Promise<{ text: string; source: string }> {
  if (file !== null) {
    return { text: await readFile(file, "utf-8"), source: resolve(file) };
  }
  const store = new GcsBackupStore(bucket);
  if (object !== LATEST_OBJECT) {
    const name = object ?? "";
    return { text: await store.read(name), source: `gs://${bucket}/${name}` };
  }
  const latest = await store.latest();
  if (latest === null) {
    fail(`the bucket gs://${bucket} holds no snapshots.`);
  }
  console.log(
    `Resolved "${LATEST_OBJECT}" to ${latest.name} (taken ${latest.takenAt.toISOString()}).`,
  );
  return { text: await store.read(latest.name), source: `gs://${bucket}/${latest.name}` };
}

/**
 * Is the origin serving the maintenance page? `null` means the probe itself failed
 * — a refused connection or a DNS failure, which is *consistent* with a down
 * environment but does not prove the edge swap happened, so it is reported as
 * unknown rather than quietly treated as a pass.
 */
async function probeMaintenance(url: string): Promise<boolean | null> {
  try {
    const response = await fetch(url, { redirect: "follow" });
    return isMaintenancePage(await response.text());
  } catch {
    return null;
  }
}

/**
 * Deliver the forensic entry to Cloud Logging via `gcloud`, which the runbook has
 * the operator authenticated with already — no new dependency, and no service-account
 * key to hand a laptop. A delivery failure is reported and does **not** fail the
 * run: the restore has already happened by this point, so exiting non-zero would
 * misrepresent the state of the database. The entry is printed and written to the
 * artifacts either way, so it is never lost — only, in that case, not retained.
 */
async function deliverAuditEntry(record: string, projectId: string): Promise<string> {
  try {
    await execFileAsync("gcloud", [
      "logging",
      "write",
      RESTORE_LOG_NAME,
      record,
      "--payload-type=json",
      "--severity=INFO",
      `--project=${projectId}`,
    ]);
    return `delivered to Cloud Logging (log "${RESTORE_LOG_NAME}", project ${projectId}).`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `NOT delivered to Cloud Logging (${detail}). The entry is in the artifacts; deliver it by hand.`;
  }
}

/**
 * The post-restore reconciliation (D101/D99), run **immediately** rather than left
 * to a scheduled job, because a rollback is precisely the event that strands Ghost
 * ahead of Book. It reuses the same pure planner the admin endpoint uses, over the
 * profiles just restored.
 *
 * Report-only, by decision (7b-3, Forrest's call): no bulk Book→Ghost re-push is
 * built. At Book's write volume the drift a restore can create is a handful of
 * records at most, and the repair path already exists — an admin re-saves each one,
 * which pushes to Ghost synchronously (D96) and is audited like any other edit. A
 * blind mass re-push is the thing D101 itself warns against, and an admin-reviewed
 * one is a new mass-write surface against Ghost for a case that does not occur.
 */
async function runGhostReconciliation(
  snapshotProfiles: ReturnType<typeof hydrateProfiles>,
  userIds: readonly number[],
  now: Date,
): Promise<{ summary: string; report: unknown | null }> {
  const apiUrl = process.env.GHOST_ADMIN_API_URL;
  const adminApiKey = process.env.GHOST_ADMIN_API_KEY;
  if (!apiUrl || !adminApiKey) {
    return {
      summary:
        "Ghost reconciliation SKIPPED: GHOST_ADMIN_API_URL/GHOST_ADMIN_API_KEY are not set. Run the Admin → Ghost audit once Book is back up.",
      report: null,
    };
  }
  const reader = new GhostAdminReader({ apiUrl, adminApiKey });
  try {
    const [members, newsletterEvents] = await Promise.all([
      reader.listMembers(),
      reader.listNewsletterEvents(),
    ]);
    const report = planGhostAudit({
      profiles: snapshotProfiles,
      userIds,
      members,
      newsletterEvents,
      generatedAt: now.toISOString(),
    });
    return {
      summary: `Ghost reconciliation: ${report.discrepancies.length} discrepancy(ies) — review the report and repair each by re-saving that brother in Book (D96 pushes the fix to Ghost).`,
      report,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { summary: `Ghost reconciliation FAILED to read Ghost: ${detail}`, report: null };
  }
}

const { options, errors: argErrors } = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}
if (argErrors.length > 0) {
  for (const error of argErrors) {
    console.error(`restore: ${error}`);
  }
  console.error("Run with --help for usage.");
  process.exit(1);
}

const projectId =
  options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
if (!projectId) {
  fail("no target project — pass --project or set GOOGLE_CLOUD_PROJECT.");
}
if (process.env.FIRESTORE_EMULATOR_HOST && !options.allowEmulator) {
  fail(
    "FIRESTORE_EMULATOR_HOST is set, which points this at the emulator. Pass --allow-emulator if that is what you want.",
  );
}
if (!options.dryRun && options.confirm !== projectId) {
  fail(
    `refusing to write: pass --confirm ${projectId} to confirm you are replacing every profile, user and config document in that project. (Or --dry-run to preview.)`,
  );
}

const bucket = options.bucket ?? `${projectId}-backups`;
const outDir = resolve(options.outDir);
const startedAt = new Date();

console.log(`==> Target project: ${projectId}`);
const { text: snapshotText, source } = await loadSnapshotText(options.file, options.object, bucket);
console.log(`==> Snapshot source: ${source}`);

let parsedJson: unknown;
try {
  parsedJson = JSON.parse(snapshotText);
} catch (error) {
  fail(`the snapshot is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const parsed = parseSnapshot(parsedJson);
if (!parsed.ok) {
  for (const issue of parsed.errors) {
    console.error(`  ERROR   [${issue.rule}] ${issue.message}`);
  }
  fail("the snapshot envelope is unreadable. Nothing was written.");
}
const snapshot = parsed.snapshot;
console.log(
  `==> Envelope version ${snapshot.version}, taken ${snapshot.generatedAt}, ${snapshot.images.length} image manifest entry(ies).`,
);

const validation = validateSnapshot(snapshot.collections);
for (const line of renderValidationReport(validation)) {
  console.log(line);
}
if (validation.errors.length > 0) {
  process.exit(1);
}

initializeApp({ projectId });
const db = getFirestore();
const target = new FirestoreRestoreTarget(db);

if (options.dryRun) {
  const plan = planRestore(await readCurrentDocIds(target), snapshot.collections);
  console.log(`[dry-run] Target project: ${projectId}`);
  for (const collectionPlan of plan.collections) {
    console.log(
      `[dry-run] ${collectionPlan.collection}: would delete ${collectionPlan.deleteIds.length} stale doc(s) and write ${collectionPlan.writeCount}.`,
    );
  }
  const nextRoster = privilegedRoster(snapshot.collections.profiles);
  const currentSnapshot = await new FirestoreBackupSource(db).export();
  for (const line of renderRosterSummary(
    nextRoster,
    rosterDelta(privilegedRoster(currentSnapshot.profiles), nextRoster),
  )) {
    console.log(`[dry-run] ${line}`);
  }
  console.log("[dry-run] No changes were made.");
  process.exit(0);
}

// The maintenance pre-flight. Not merely advisory: with Book up, the single
// instance keeps serving its cache as authoritative over data that no longer
// exists, and any edit it accepts writes into the restored collections (D83/D118).
const hostingUrl = options.hostingUrl ?? `https://${projectId}.web.app`;
if (options.force) {
  console.log("==> Maintenance pre-flight SKIPPED (--force).");
} else {
  const inMaintenance = await probeMaintenance(hostingUrl);
  if (inMaintenance === false) {
    fail(
      `${hostingUrl} is not serving the maintenance page. Run infra/maintenance-on.sh first (or --force if this environment has no Hosting).`,
    );
  }
  console.log(
    inMaintenance === null
      ? `==> Maintenance pre-flight: ${hostingUrl} did not answer. Treating as down; confirm it yourself.`
      : `==> Maintenance pre-flight: ${hostingUrl} is serving the maintenance page.`,
  );
}

await mkdir(outDir, { recursive: true });
const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const artifact = async (name: string, body: unknown): Promise<string> => {
  const path = resolve(outDir, `${stamp}-${name}`);
  await writeFile(path, typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
  return path;
};

// The safety snapshot: the undo, and the only place the pre-restore roster
// survives the replace (D101's "when that prior state is readable").
let priorRoster = null;
if (options.safetySnapshot) {
  const current = await new FirestoreBackupSource(db).export();
  priorRoster = privilegedRoster(current.profiles);
  const path = await artifact("safety-snapshot.json", buildBackupSnapshot(current, startedAt));
  console.log(`==> Safety snapshot of the CURRENT data written to ${path}`);
} else {
  console.log("==> Safety snapshot SKIPPED (--no-safety-snapshot); no undo, and no roster delta.");
}

console.log("==> Replacing profiles, users and config …");
const plan = await executeRestore(target, snapshot.collections, (message) => console.log(message));
console.log(
  `==> Restored: ${plan.totalWrites} document(s) written, ${plan.totalDeletes} stale removed.`,
);

const roster = privilegedRoster(snapshot.collections.profiles);
const delta = priorRoster === null ? null : rosterDelta(priorRoster, roster);
for (const line of renderRosterSummary(roster, delta)) {
  console.log(line);
}

// The forensic entry, captured rather than printed by the sink so it can be both
// delivered and archived — one serialization, three destinations.
let auditRecord = "";
const audit = new AuditLog({
  write(record) {
    auditRecord = JSON.stringify(record);
  },
});
audit.record(buildRestoreAuditEntry(roster, delta), startedAt.toISOString());
console.log(`==> Forensic entry: ${auditRecord}`);
console.log(`==> ${await deliverAuditEntry(auditRecord, projectId)}`);

const restoredProfiles = hydrateProfiles(snapshot.collections.profiles);
const userIds = snapshot.collections.users
  .map((doc) => Number(doc.id))
  .filter((id) => Number.isInteger(id));

let ghost: Awaited<ReturnType<typeof runGhostReconciliation>> = {
  summary: "Ghost reconciliation SKIPPED (--skip-ghost-audit).",
  report: null,
};
if (!options.skipGhostAudit) {
  ghost = await runGhostReconciliation(restoredProfiles, userIds, new Date());
  if (ghost.report !== null) {
    console.log(
      `==> Ghost discrepancy report written to ${await artifact("ghost-audit.json", ghost.report)}`,
    );
  }
}
console.log(`==> ${ghost.summary}`);

const reportPath = await artifact("restore-report.json", {
  restoredAt: startedAt.toISOString(),
  projectId,
  source,
  snapshot: { version: snapshot.version, generatedAt: snapshot.generatedAt },
  validation,
  plan,
  roster,
  delta,
  auditEntry: JSON.parse(auditRecord || "null"),
  ghost: ghost.summary,
});
console.log(`==> Restore report written to ${reportPath}`);
console.log(
  [
    "",
    "NEXT — the restore is not visible until Book restarts:",
    "  1. Force a Cloud Run cold start so the cache and email index rehydrate:",
    `       gcloud run deploy pbe-book-api --image <current-image-sha> --project ${projectId}`,
    '     (same image, new revision; confirm the "N profiles cached" line in the startup log.)',
    `  2. Bring Book back up:  PROJECT_ID=${projectId} ./infra/maintenance-off.sh`,
    "  3. Work the Ghost discrepancy report: re-save each drifted brother in Book.",
    "",
    `Artifacts (REAL MEMBER PII — do not commit or share): ${outDir}`,
  ].join("\n"),
);
process.exit(0);
