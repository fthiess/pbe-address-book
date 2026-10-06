#!/usr/bin/env tsx
/**
 * renumber — the one-off Constitution-ID renumber (OFC-463, D195): close a
 * one-number gap left by deleting a profile, by shifting every id above it down
 * by one. Three modes, run in this order inside a maintenance window:
 *
 *   1. `--snapshot`  Read a backup snapshot and write the transformed snapshot plus
 *                    a plan file (the moves, the image copies, the counts). Writes
 *                    nothing to any cloud. The transformed snapshot then goes in
 *                    through the ordinary offline restore (D101), which validates
 *                    it and archives a safety snapshot of the current data first.
 *   2. `--copy-images <plan>`  Copy each moved brother's headshot and thumbnail to
 *                    the new id's prefix (same version token, so the URL changes
 *                    with the id and no browser cache can serve the wrong photo).
 *                    Additive: the old objects stay, so the safety snapshot is a
 *                    complete undo. Clear them later with `images:sweep`.
 *   3. `--purge-sessions`  Delete every `sessions` document. A live session names
 *                    its brother by id (`identity.profileId`), so after the shift it
 *                    would resolve to the next brother down; and the session store's
 *                    in-memory read-through cache means only the cold start that
 *                    follows actually ends them.
 *
 * Then the forced cold start (D181) and `infra/maintenance-end.sh`. The procedure,
 * as run, is in DECISIONS N198.
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   npm run renumber --workspace apps/api -- --snapshot --project <id> \
 *     (--object latest | --file <path>) --gap <id> --expect <count>
 *   npm run renumber --workspace apps/api -- --copy-images <plan> --project <id> \
 *     --bucket <images bucket> (--dry-run | --confirm <id>)
 *   npm run renumber --workspace apps/api -- --purge-sessions --project <id> (--dry-run | --confirm <id>)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { buildBackupSnapshot } from "../data/backup.js";
import { parseSnapshot, validateSnapshot } from "../data/restore.js";
import { loadSnapshotText } from "./backup-io.js";
import {
  type FreeTextHit,
  type IdMove,
  type ImageCopy,
  type RenumberCounts,
  type RenumberResult,
  renumberSnapshot,
} from "./renumber-plan.js";
import { LATEST_OBJECT, maintenanceRefusal, renderValidationReport } from "./restore-support.js";

const TOOL = "renumber";
const DEFAULT_OUT_DIR = "restore-artifacts";
/** Firestore's batched-write ceiling. */
const BATCH_LIMIT = 500;

function printHelp(): void {
  console.log(
    [
      "renumber — close a one-number gap in the Constitution IDs (OFC-463, D195).",
      "",
      "Modes (exactly one):",
      "  --snapshot              Transform a backup snapshot; writes local files only.",
      "  --copy-images <plan>    Copy moved brothers' images to their new id prefix.",
      "  --purge-sessions        Delete every session (everyone signs in again).",
      "",
      "Options:",
      "  --project <id>          Target GCP project.",
      '  --object <name>         --snapshot: a backup-bucket object, or "latest".',
      "  --file <path>           --snapshot: a snapshot JSON on disk instead.",
      "  --backup-bucket <name>  --snapshot: the backup bucket (default <project>-backups).",
      "  --gap <id>              --snapshot: the vacated id; every id above it moves down one.",
      "  --expect <count>        --snapshot: how many profiles must move (refuses otherwise).",
      "  --bucket <name>         --copy-images: the private image bucket (IMAGE_BUCKET).",
      "  --confirm <id>          Must equal --project. Required to write anything.",
      "  --dry-run               Report what would happen; write nothing.",
      "  --hosting-url <url>     --purge-sessions: origin probed for the maintenance page.",
      "  --force                 --purge-sessions: skip the maintenance pre-flight.",
      "  --out <dir>             Where artifacts go (default restore-artifacts/).",
      "  --help, -h              Show this help and exit.",
      "",
      "⚠ The snapshot and plan files hold REAL MEMBER PII. restore-artifacts/ is gitignored.",
    ].join("\n"),
  );
}

function fail(message: string): never {
  console.error(`${TOOL}: ${message}`);
  process.exit(1);
}

// ---- arguments -------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}
const FLAGS = ["--snapshot", "--purge-sessions", "--dry-run", "--force"];
const VALUED = [
  "--project",
  "--object",
  "--file",
  "--backup-bucket",
  "--gap",
  "--expect",
  "--copy-images",
  "--bucket",
  "--confirm",
  "--hosting-url",
  "--out",
];
const values: Record<string, string> = {};
const flags = new Set<string>();
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (FLAGS.includes(arg)) {
    flags.add(arg);
    continue;
  }
  if (!VALUED.includes(arg)) {
    fail(`unknown argument ${arg} (see --help).`);
  }
  const value = args[++i];
  if (value === undefined || value.startsWith("--")) {
    fail(`${arg} needs a value.`);
  }
  values[arg.slice(2)] = value;
}
const modes = [
  flags.has("--snapshot") ? "snapshot" : null,
  values["copy-images"] !== undefined ? "copy-images" : null,
  flags.has("--purge-sessions") ? "purge-sessions" : null,
].filter((m) => m !== null);
if (modes.length !== 1) {
  fail("pass exactly one of --snapshot, --copy-images or --purge-sessions.");
}
const mode = modes[0] as "snapshot" | "copy-images" | "purge-sessions";
const projectId: string = values.project ?? fail("--project is required.");
const dryRun = flags.has("--dry-run");
if (mode !== "snapshot" && !dryRun && values.confirm !== projectId) {
  fail(`refusing to write: pass --confirm ${projectId} (or --dry-run).`);
}
const outDir = resolve(values.out ?? DEFAULT_OUT_DIR);
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");

initializeApp({ projectId });

// ---- 1. snapshot -----------------------------------------------------------

/** The plan file `--snapshot` writes and `--copy-images` reads. */
interface RenumberPlanFile {
  tool: typeof TOOL;
  projectId: string;
  source: string;
  sourceGeneratedAt: string;
  gap: number;
  snapshotPath: string;
  counts: RenumberCounts;
  moves: IdMove[];
  imageCopies: ImageCopy[];
  freeTextHits: FreeTextHit[];
}

function positiveInt(name: string): number {
  const raw = values[name];
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value <= 0) {
    fail(`--${name} must be a positive integer.`);
  }
  return value;
}

/** Print what the transform did — before anything is written, so a dry run shows it too. */
function reportTransform(result: Extract<RenumberResult, { ok: true }>): void {
  const c = result.counts;
  const first = result.moves[0];
  const last = result.moves[result.moves.length - 1];
  console.log(
    `==> Moves #${first?.from}–#${last?.from} → #${first?.to}–#${last?.to} (${c.profilesMoved} profiles); ` +
      `${c.bigBrotherIds} bigBrotherId, ${c.verifiedBy} verifiedBy, ${c.consentSnapshotVerifiedBy} consent-snapshot verifiedBy, ` +
      `${c.usersMoved} users docs, ${c.stars} stars, ${c.bannerUpdatedBy} banner updatedBy; ${result.imageCopies.length} image objects to copy.`,
  );
  for (const hit of result.freeTextHits) {
    console.log(
      `  NOTE ${hit.collection}/${hit.docId} \`${hit.path}\` names a moved id in a URL — not rewritten; review by hand.`,
    );
  }
}

async function runSnapshot(): Promise<number> {
  const file = values.file ?? null;
  const object = values.object ?? null;
  if ((file === null) === (object === null)) {
    fail(`pass exactly one of --file or --object (e.g. --object ${LATEST_OBJECT}).`);
  }
  const gap = positiveInt("gap");
  const expectShifted = positiveInt("expect");
  const loaded = await loadSnapshotText(
    file,
    object,
    values["backup-bucket"] ?? `${projectId}-backups`,
  );
  console.log(`==> Snapshot source: ${loaded.source}`);
  let raw: unknown;
  try {
    raw = JSON.parse(loaded.text);
  } catch (error) {
    fail(`the snapshot is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) {
    for (const issue of parsed.errors) {
      console.error(`  ERROR [${issue.rule}] ${issue.message}`);
    }
    fail("the snapshot envelope is unreadable.");
  }
  const { snapshot } = parsed;
  console.log(
    `==> Taken ${snapshot.generatedAt}; ${snapshot.collections.profiles.length} profiles.`,
  );

  const result = renumberSnapshot(snapshot.collections, { gap, expectShifted });
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`  ERROR ${error}`);
    }
    fail("refusing to renumber; nothing was written.");
  }
  // The restore will validate again; validating here too means a bad transform is
  // caught before a maintenance window is spent on it.
  const validation = validateSnapshot(result.collections);
  for (const line of renderValidationReport(validation)) {
    console.log(line);
  }
  if (validation.errors.length > 0) {
    fail("the transformed snapshot does not validate; nothing was written.");
  }

  reportTransform(result);
  if (dryRun) {
    console.log("==> [dry-run] Wrote nothing.");
    return 0;
  }
  await mkdir(outDir, { recursive: true });
  const snapshotPath = resolve(outDir, `${TOOL}-${stamp}-snapshot.json`);
  await writeFile(
    snapshotPath,
    `${JSON.stringify(buildBackupSnapshot(result.collections, new Date()), null, 2)}\n`,
  );
  const plan: RenumberPlanFile = {
    tool: TOOL,
    projectId,
    source: loaded.source,
    sourceGeneratedAt: snapshot.generatedAt,
    gap,
    snapshotPath,
    counts: result.counts,
    moves: result.moves,
    imageCopies: result.imageCopies,
    freeTextHits: result.freeTextHits,
  };
  const planPath = resolve(outDir, `${TOOL}-${stamp}-plan.json`);
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  console.log(`==> Transformed snapshot: ${snapshotPath}`);
  console.log(`==> Plan (moves + image copies): ${planPath}`);
  console.log("    REAL MEMBER PII — keep both out of the repo and off shared storage.");
  return 0;
}

// ---- 2. copy images --------------------------------------------------------

const COPY_FAILURES = new Set(["source-missing", "target-differs", "copy-mismatch"]);

/**
 * Copy one object to its new key, idempotently: a target already holding the
 * source's bytes (by MD5) is done, and a target holding different bytes is refused
 * rather than overwritten.
 */
async function copyOne(
  copy: ImageCopy,
  md5Of: (key: string) => Promise<string | null>,
  doCopy: (from: string, to: string) => Promise<void>,
): Promise<string> {
  const [source, target] = await Promise.all([md5Of(copy.from), md5Of(copy.to)]);
  if (source === null) {
    // Even with a target present: nothing can prove it holds this brother's bytes.
    return "source-missing";
  }
  if (target === source) {
    return "already-done";
  }
  if (target !== null) {
    return "target-differs";
  }
  if (dryRun) {
    return "would-copy";
  }
  await doCopy(copy.from, copy.to);
  return (await md5Of(copy.to)) === source ? "copied" : "copy-mismatch";
}

async function runCopyImages(planPath: string): Promise<number> {
  const bucketName = values.bucket;
  if (!bucketName) {
    fail("--bucket (the private image bucket) is required.");
  }
  let plan: RenumberPlanFile;
  try {
    plan = JSON.parse(await readFile(resolve(planPath), "utf8")) as RenumberPlanFile;
  } catch (error) {
    fail(`cannot read the plan ${resolve(planPath)}: ${(error as Error).message}`);
  }
  if (plan?.tool !== TOOL || !Array.isArray(plan.imageCopies)) {
    fail(`${planPath} is not a ${TOOL} plan file.`);
  }
  if (plan.projectId !== projectId) {
    fail(`${planPath} was planned for ${plan.projectId}, not ${projectId}.`);
  }
  const bucket = getStorage().bucket(bucketName);
  const md5Of = async (key: string): Promise<string | null> => {
    try {
      const [metadata] = await bucket.file(key).getMetadata();
      return typeof metadata.md5Hash === "string" ? metadata.md5Hash : null;
    } catch (error) {
      if ((error as { code?: number }).code === 404) {
        return null;
      }
      throw error;
    }
  };

  const outcomes: { from: string; to: string; outcome: string }[] = [];
  let errors = 0;
  for (const copy of plan.imageCopies) {
    const outcome = await copyOne(copy, md5Of, (from, to) =>
      bucket
        .file(from)
        .copy(bucket.file(to))
        .then(() => undefined),
    );
    if (COPY_FAILURES.has(outcome)) {
      errors++;
      console.error(`  ERROR ${copy.from} → ${copy.to}: ${outcome}`);
    }
    outcomes.push({ ...copy, outcome });
  }
  const tally = new Map<string, number>();
  for (const o of outcomes) {
    tally.set(o.outcome, (tally.get(o.outcome) ?? 0) + 1);
  }
  console.log(
    `==> ${dryRun ? "[dry-run] " : ""}${plan.imageCopies.length} object(s): ${[...tally].map(([k, n]) => `${n} ${k}`).join(", ")}.`,
  );
  if (!dryRun) {
    await mkdir(outDir, { recursive: true });
    const recordPath = resolve(outDir, `${TOOL}-${stamp}-image-copies.json`);
    await writeFile(
      recordPath,
      `${JSON.stringify({ tool: TOOL, kind: "copy-images", projectId, bucket: bucketName, of: resolve(planPath), at: new Date().toISOString(), outcomes }, null, 2)}\n`,
    );
    console.log(`==> Copy record: ${recordPath}`);
  }
  return errors > 0 ? 1 : 0;
}

// ---- 3. purge sessions -----------------------------------------------------

async function runPurgeSessions(): Promise<number> {
  const db = getFirestore();
  const refs = await db.collection("sessions").listDocuments();
  if (dryRun) {
    console.log(`==> [dry-run] would delete ${refs.length} session document(s).`);
    return 0;
  }
  if (flags.has("--force")) {
    console.log("==> Maintenance pre-flight SKIPPED (--force).");
  } else {
    const hostingUrl = values["hosting-url"] ?? `https://${projectId}.web.app`;
    const refusal = await maintenanceRefusal(hostingUrl);
    if (refusal !== null) {
      fail(refusal);
    }
    console.log(`==> Maintenance pre-flight: ${hostingUrl} is serving the maintenance page.`);
  }
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
  console.log(`==> Deleted ${refs.length} session document(s).`);
  console.log(
    "==> NOW force a cold start (infra/RUNBOOK.md): the session store's in-memory cache keeps serving them until the instance is replaced.",
  );
  return 0;
}

const code =
  mode === "snapshot"
    ? await runSnapshot()
    : mode === "copy-images"
      ? await runCopyImages(values["copy-images"] as string)
      : await runPurgeSessions();
process.exit(code);
