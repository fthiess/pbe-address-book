#!/usr/bin/env tsx
import process from "node:process";
import { initializeApp } from "firebase-admin/app";
import { parseSnapshot, validateSnapshot } from "../data/restore.js";
import { loadSnapshotText, openFirestore } from "./backup-io.js";
import { describeTarget } from "./restore-support.js";
import { listImageKeys, readRestoredState } from "./verify-backup-state.js";
import {
  DEFAULT_MAX_AGE_HOURS,
  parseVerifyArgs,
  renderVerdict,
  runChecks,
} from "./verify-backup-support.js";

/**
 * **The backup-integrity check** (D102/D151; OFC-333) — the second half of the
 * integrity job's thin rehearsal: after `restore --database <id>` has replaced a
 * throwaway database in the `pbe-book-verify` project with the newest backup, this
 * reads that database back and decides whether the backup would actually bring Book
 * back. It writes nothing, anywhere.
 *
 * The job's shell wrapper (`infra/verify-backup.sh`, PL-6b) owns the database's
 * lifecycle — create, restore, this check, delete from a trap. This tool neither
 * creates nor deletes anything, so a bug here can cost a wrong verdict but never
 * the database it reads or the one it protects.
 *
 * Output: human-readable lines, then a final `VERDICT {json}` line of counts and
 * booleans only (never PII). Exit 0 = verified, 1 = a check failed or the check
 * could not run, 2 = usage error.
 */

function printHelp(): void {
  console.log(
    [
      "backup:verify — check that a restored backup would bring Book back (D102/D151).",
      "",
      "Run after `restore --database <id>` into a throwaway database. Reads only.",
      "",
      "Usage:",
      "  npm run backup:verify --workspace apps/api -- --object <name> --bucket <backups>",
      "      --project <verify-project> --database <id> --image-bucket <images>",
      "",
      "Snapshot (exactly one — the SAME snapshot the restore read):",
      "  --file <path>          A snapshot JSON on disk.",
      "  --object <name>        An object in --bucket. Must be a resolved name, not `latest`.",
      "",
      "Options:",
      "  --bucket <name>        The SOURCE environment's backup bucket (required with --object).",
      "  --project <id>         Project holding the restored database (default: GOOGLE_CLOUD_PROJECT).",
      "  --database <id>        The named database the restore wrote (required; never the default).",
      "  --image-bucket <name>  The SOURCE environment's image bucket (required).",
      `  --max-age-hours <n>    Oldest acceptable snapshot (default: ${DEFAULT_MAX_AGE_HOURS}, matching D149).`,
      "  --allow-emulator       Permit running against FIRESTORE_EMULATOR_HOST.",
      "  --help,-h              Show this help and exit.",
      "",
      "Exit status: 0 verified, 1 a check failed (or the check could not run), 2 usage error.",
    ].join("\n"),
  );
}

function fail(message: string): never {
  console.error(`backup:verify: ${message}`);
  process.exit(1);
}

const { options, errors } = parseVerifyArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`backup:verify: ${error}`);
  }
  console.error("Run with --help for usage.");
  process.exit(2);
}

const projectId =
  options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error("backup:verify: no project — pass --project or set GOOGLE_CLOUD_PROJECT.");
  process.exit(2);
}
if (process.env.FIRESTORE_EMULATOR_HOST && !options.allowEmulator) {
  console.error(
    "backup:verify: FIRESTORE_EMULATOR_HOST is set, which points this at the emulator. Pass --allow-emulator if that is what you want.",
  );
  process.exit(2);
}

console.log(`==> Checking: ${describeTarget(projectId, options.database)}`);
// SDK configuration only (see restore.ts): `--object` and the image listing read
// GCS through `getStorage()`, which throws `app/no-app` without it.
initializeApp({ projectId });

try {
  const loaded = await loadSnapshotText(options.file, options.object, options.bucket ?? "");
  console.log(`==> Snapshot source: ${loaded.source}`);
  const parsed = parseSnapshot(JSON.parse(loaded.text));
  if (!parsed.ok) {
    fail(`the snapshot envelope is unreadable (${parsed.errors.length} envelope error(s)).`);
  }
  const snapshot = parsed.snapshot;
  // Envelope faults aside, validation is not re-litigated here — the restore already
  // refused an invalid snapshot. It is re-run so the verdict records the same
  // warnings count the restore saw, from the snapshot alone.
  const validation = validateSnapshot(snapshot.collections);

  const [restored, imageKeys] = await Promise.all([
    readRestoredState(openFirestore(options.database)),
    listImageKeys(options.imageBucket ?? ""),
  ]);

  const verdict = runChecks({
    snapshot,
    validation,
    restored,
    imageKeys,
    now: new Date(),
    maxAgeHours: options.maxAgeHours,
  });
  for (const line of renderVerdict(verdict)) {
    console.log(line);
  }
  console.log(`VERDICT ${JSON.stringify(verdict)}`);
  process.exit(verdict.ok ? 0 : 1);
} catch (error) {
  // A check that cannot run is a failed check, never a pass: the scheduled job
  // alerts on a non-zero exit, and "could not tell" must reach a human.
  fail(error instanceof Error ? error.message : String(error));
}
