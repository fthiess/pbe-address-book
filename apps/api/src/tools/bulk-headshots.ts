#!/usr/bin/env tsx
/**
 * bulk-headshots — load a batch of prepared headshots into a live environment
 * (D182), with an exact undo and a later cleanup.
 *
 * WHY. The launch loaded 135 headshots through the genesis restore (D180). A later
 * batch — portraits cropped from the house composites — has to land on a LIVE
 * directory, where brothers may have added their own photos since the batch was
 * chosen. This tool does what `PUT /api/profiles/:id/headshot` does, for many
 * profiles at once: each PNG goes through the same `encodeHeadshot` pipeline, the
 * 512² + 96² WEBP objects are written FIRST, and only then does the profile's
 * `hasHeadshot` / `headshotVersion` pointer move (D98). Nothing else is written —
 * not `lastModified` (D181: that stamp means "a person edited this").
 *
 * THE PLAN. `--plan <csv>` with header `const_id,file,expected_version`: the PNG
 * (relative paths resolve against the plan's folder), and the photo version the
 * operator saw when choosing (blank = none). A profile that no longer shows that
 * version is skipped as `changed` — a brother's own photo is never overwritten —
 * and every pointer write is also conditional on the `updateTime` read just
 * before it. Versions are content hashes (`headshotVersionOf`), so a re-run after
 * a partial failure finds the finished rows `already-done`.
 *
 * ⚠ THEN FORCE A COLD START. Book serves from an in-memory cache hydrated only
 * at cold start (D83): until the instance is replaced the new photos are
 * invisible, and an edit to a touched record gets a 412 (the cache holds the
 * pre-write token; the SPA recovers, D109). By default uploads and undos refuse to
 * write unless the maintenance page is up (D100/D118). `--book-up` runs with Book
 * serving instead — D181's model, and how the first load ran (D182), because the
 * maintenance scripts republish Hosting from a local build (OFC-449). `--force`
 * skips the pre-flight only for an environment with no Hosting.
 *
 * UNDO AND PURGE. Before the first write the run records
 * `<out>/bulk-headshots-<timestamp>.json`: each target's prior photo version and
 * the new one (rewritten with outcomes at the end). The replaced photos' objects
 * are NOT deleted, so `--undo <that file>` repoints each profile still showing
 * this run's photo back to its prior one, instantly. Once the result is accepted,
 * `--purge <that file>` deletes the replaced photos' objects (after which undo is
 * no longer possible). Purge deletes only unreferenced objects, so it needs no
 * maintenance window.
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   npm run headshots:bulk --workspace apps/api -- --project <id> --bucket <name> \
 *     (--plan <csv> | --undo <artifact> | --purge <artifact>) (--dry-run | --confirm <id>)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { GcsImageStore } from "../data/images.js";
import { encodeHeadshot } from "../images/encode.js";
import {
  FirestorePointerStore,
  executePurge,
  executeUndo,
  executeUploads,
} from "./bulk-headshots-executor.js";
import {
  type ArtifactItem,
  type PlanRow,
  type UploadDecision,
  parsePlan,
  planPurge,
  planUndo,
  planUploads,
} from "./bulk-headshots-plan.js";
import { headshotVersionOf } from "./headshot-files.js";
import { probeMaintenance } from "./restore-support.js";

const DEFAULT_OUT_DIR = "restore-artifacts";
const TOOL = "bulk-headshots";

function printHelp(): void {
  console.log(
    [
      "bulk-headshots — load a batch of headshots into a live environment, with undo and cleanup.",
      "",
      "Usage:",
      "  npm run headshots:bulk --workspace apps/api -- --project <id> --bucket <name>",
      "      (--plan <csv> | --undo <artifact> | --purge <artifact>) (--dry-run | --confirm <id>)",
      "",
      "Modes:",
      "  --plan <csv>        Upload: rows `const_id,file,expected_version` (blank version = no photo).",
      "  --undo <artifact>   Point every profile this run changed back at its prior photo.",
      "  --purge <artifact>  Delete the photos this run replaced (undo is impossible afterwards).",
      "",
      "Options:",
      "  --project <id>      Target GCP project.",
      "  --bucket <name>     The environment's private image bucket (IMAGE_BUCKET).",
      "  --confirm <id>      Must equal --project. Required to write anything.",
      "  --dry-run           Read the live pointers and plan (uploads also encode every photo); write nothing.",
      "  --hosting-url <url> Origin probed for the maintenance page (default https://<project>.web.app).",
      "  --book-up           Write with Book serving (D181 model; see OFC-449): skip the maintenance",
      "                      pre-flight, then force a cold start at once.",
      "  --force             Skip the maintenance pre-flight (environments with no Hosting only).",
      "  --out <dir>         Where the run artifact goes (default restore-artifacts/).",
      "  --help, -h          Show this help and exit.",
      "",
      "⚠ Uploads and undos need Book in maintenance (infra/maintenance-on.sh) or --book-up, then a forced cold start.",
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
const values: Record<string, string> = {};
const flags = new Set<string>();
const VALUED = [
  "--project",
  "--bucket",
  "--plan",
  "--undo",
  "--purge",
  "--confirm",
  "--hosting-url",
  "--out",
];
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg === "--dry-run" || arg === "--force" || arg === "--book-up") {
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
for (const required of ["project", "bucket"]) {
  if (!values[required]) {
    fail(`--${required} is required.`);
  }
}
const modes = (["plan", "undo", "purge"] as const).filter((m) => values[m] !== undefined);
if (modes.length !== 1) {
  fail("pass exactly one of --plan, --undo or --purge.");
}
const mode = modes[0] as "plan" | "undo" | "purge";
const projectId = values.project as string;
const bucketName = values.bucket as string;
const dryRun = flags.has("--dry-run");
if (!dryRun && values.confirm !== projectId) {
  fail(`refusing to write: pass --confirm ${projectId} (or --dry-run).`);
}
const outDir = resolve(values.out ?? DEFAULT_OUT_DIR);

initializeApp({ projectId });
const pointers = new FirestorePointerStore(getFirestore());
const images = new GcsImageStore(bucketName);

// ---- shared helpers ----------------------------------------------------------

/** Refuse to write pointers unless Book is serving the maintenance page (as the restore does). */
async function requireMaintenance(): Promise<void> {
  const hostingUrl = values["hosting-url"] ?? `https://${projectId}.web.app`;
  if (flags.has("--book-up")) {
    console.log(
      "==> --book-up: writing with Book SERVING. Force a cold start the moment this finishes — until then the new photos are invisible and edits to these records get 412.",
    );
    return;
  }
  if (flags.has("--force")) {
    console.log("==> Maintenance pre-flight SKIPPED (--force).");
    return;
  }
  const inMaintenance = await probeMaintenance(hostingUrl);
  if (inMaintenance !== true) {
    fail(
      inMaintenance === false
        ? `${hostingUrl} is not serving the maintenance page. Run infra/maintenance-on.sh first.`
        : `${hostingUrl} did not answer, so this cannot confirm Book is down. Check --hosting-url.`,
    );
  }
  console.log(`==> Maintenance pre-flight: ${hostingUrl} is serving the maintenance page.`);
}

interface Artifact {
  tool: string;
  projectId: string;
  bucket: string;
  status: "in-progress" | "done";
  startedAt: string;
  finishedAt?: string;
  items: ArtifactItem[];
}

async function readArtifact(path: string): Promise<Artifact> {
  let artifact: Artifact;
  try {
    artifact = JSON.parse(await readFile(resolve(path), "utf8")) as Artifact;
  } catch (error) {
    // npm runs this with cwd apps/api/, so a relative path resolves from there.
    fail(`cannot read the artifact ${resolve(path)}: ${(error as Error).message}`);
  }
  if (artifact?.tool !== TOOL || !Array.isArray(artifact.items)) {
    fail(`${path} is not a ${TOOL} run artifact.`);
  }
  if (artifact.projectId !== projectId || artifact.bucket !== bucketName) {
    fail(
      `${path} records a run on ${artifact.projectId} / ${artifact.bucket}, not ${projectId} / ${bucketName}.`,
    );
  }
  return artifact;
}

/** Undo and purge record what they did next to the run artifact they acted on. */
async function writeRecord(
  artifactPath: string,
  kind: "undo" | "purge",
  result: object,
): Promise<string> {
  const stamp = new Date().toISOString();
  const path = resolve(
    dirname(resolve(artifactPath)),
    `${TOOL}-${kind}-${stamp.replace(/[:.]/gu, "-")}.json`,
  );
  const record = {
    tool: TOOL,
    kind,
    projectId,
    bucket: bucketName,
    of: resolve(artifactPath),
    at: stamp,
    ...result,
  };
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}

function coldStartReminder(): void {
  console.log(
    `==> NOW force a cold start of pbe-book-api in ${projectId} (infra/README.md) and confirm "N profiles cached"${flags.has("--book-up") ? "." : ", then end maintenance."}`,
  );
}

// ---- upload ----------------------------------------------------------------

interface LoadedPlan {
  readonly rows: PlanRow[];
  readonly bytes: Map<number, Buffer>;
  readonly targets: Map<number, string>;
}

/** Parse the plan and read + hash every PNG it names; any problem refuses the run. */
async function loadPlan(planPath: string): Promise<LoadedPlan> {
  const plan = parsePlan(await readFile(resolve(planPath), "utf8"));
  if (plan.errors.length > 0) {
    for (const error of plan.errors) {
      console.error(`  ERROR ${error}`);
    }
    fail(`the plan has ${plan.errors.length} error(s); nothing was done.`);
  }
  const base = dirname(resolve(planPath));
  const bytes = new Map<number, Buffer>();
  const targets = new Map<number, string>();
  for (const row of plan.rows) {
    const path = resolve(base, row.file);
    try {
      const buffer = await readFile(path);
      bytes.set(row.id, buffer);
      targets.set(row.id, headshotVersionOf(buffer));
    } catch {
      fail(`#${row.id} (plan line ${row.line}): cannot read ${path}`);
    }
  }
  return { rows: plan.rows, bytes, targets };
}

function reportDecisions(rows: number, decisions: readonly UploadDecision[]): void {
  const count = (kind: UploadDecision["kind"]) => decisions.filter((d) => d.kind === kind).length;
  console.log(
    `==> ${rows} row(s) for ${projectId}: ${count("upload")} to upload, ${count("already-done")} already done, ${count("changed")} changed since chosen, ${count("missing")} with no profile.`,
  );
  for (const d of decisions) {
    if (d.kind === "changed") {
      console.log(
        `  skip #${d.row.id}: now shows ${d.found ?? "no photo"}, not ${d.row.expectedVersion ?? "no photo"}`,
      );
    } else if (d.kind === "missing") {
      console.log(`  skip #${d.row.id}: no such profile`);
    }
  }
}

/** Dry run: encode every upload so a bad image is found now, not mid-run. */
async function dryRunEncode(
  decisions: readonly UploadDecision[],
  bytes: Map<number, Buffer>,
): Promise<number> {
  let bytesOut = 0;
  let good = 0;
  const bad: string[] = [];
  for (const d of decisions) {
    if (d.kind !== "upload") {
      continue;
    }
    try {
      const encoded = await encodeHeadshot(bytes.get(d.row.id) as Buffer);
      bytesOut += encoded.headshot.byteLength + encoded.thumbnail.byteLength;
      good++;
    } catch (error) {
      bad.push(`#${d.row.id}: ${(error as Error).message}`);
    }
  }
  for (const line of bad) {
    console.error(`  ERROR ${line}`);
  }
  console.log(
    `==> [dry-run] ${good} photo(s) encode cleanly (${(bytesOut / 1024).toFixed(0)} KB); ${bad.length} failed. Wrote nothing.`,
  );
  return bad.length > 0 ? 1 : 0;
}

/** Writes the run artifact: the intended set before any write, the outcomes after. */
function artifactWriter(): {
  path: string;
  save: (items: readonly ArtifactItem[], done: boolean) => Promise<void>;
} {
  const startedAt = new Date().toISOString();
  const path = resolve(outDir, `${TOOL}-${startedAt.replace(/[:.]/gu, "-")}.json`);
  // The executor saves once with every item `intended` before any write (a superset
  // is a safe undo), then once with the outcomes.
  const save = async (items: readonly ArtifactItem[], done: boolean) => {
    const artifact: Artifact = {
      tool: TOOL,
      projectId,
      bucket: bucketName,
      status: done ? "done" : "in-progress",
      startedAt,
      ...(done ? { finishedAt: new Date().toISOString() } : {}),
      items: [...items],
    };
    await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`);
  };
  return { path, save };
}

async function runUpload(planPath: string): Promise<number> {
  const plan = await loadPlan(planPath);
  const current = await pointers.read(plan.rows.map((r) => r.id));
  const decisions = planUploads(plan.rows, plan.targets, current);
  reportDecisions(plan.rows.length, decisions);
  if (dryRun) {
    return dryRunEncode(decisions, plan.bytes);
  }
  if (!decisions.some((d) => d.kind === "upload")) {
    console.log("==> Nothing to upload.");
    return 0;
  }

  await requireMaintenance();
  await mkdir(outDir, { recursive: true });
  const artifact = artifactWriter();
  const outcome = await executeUploads(
    decisions,
    {
      pointers,
      images,
      encode: encodeHeadshot,
      bytesOf: (id) => plan.bytes.get(id) as Buffer,
      saveArtifact: artifact.save,
      log: (line) => console.log(line),
    },
    current,
  );
  console.log(`==> Undo list written to ${artifact.path}`);
  const by = (o: ArtifactItem["outcome"]) => outcome.items.filter((i) => i.outcome === o);
  for (const i of by("changed")) {
    console.log(`  skipped #${i.id}: edited since the read; left as is.`);
  }
  for (const error of outcome.errors) {
    console.error(`  ERROR ${error}`);
  }
  console.log(
    `==> Uploaded ${by("written").length}; ${by("changed").length} changed since the read; ${by("missing").length} missing; ${by("failed").length} failed.`,
  );
  coldStartReminder();
  return outcome.errors.length > 0 ? 1 : 0;
}

// ---- undo ------------------------------------------------------------------

async function runUndo(path: string): Promise<number> {
  const artifact = await readArtifact(path);
  const decisions = planUndo(artifact.items, await pointers.read(artifact.items.map((i) => i.id)));
  const reverts = decisions.filter((d) => d.kind === "revert").length;
  console.log(
    `==> ${artifact.items.length} item(s) in ${path}: ${reverts} to revert, ${decisions.length - reverts} no longer showing this run's photo.`,
  );
  if (dryRun) {
    console.log("==> [dry-run] Wrote nothing.");
    return 0;
  }
  await requireMaintenance();
  const result = await executeUndo(decisions, pointers, images);
  console.log(`==> Undo recorded in ${await writeRecord(path, "undo", result)}`);
  for (const line of result.skipped) {
    console.log(`  skipped ${line}`);
  }
  for (const error of result.errors) {
    console.error(`  ERROR ${error}`);
  }
  console.log(
    `==> Reverted ${result.reverted.length}; ${result.skipped.length} skipped; ${result.errors.length} failed.`,
  );
  coldStartReminder();
  return result.errors.length > 0 ? 1 : 0;
}

// ---- purge -----------------------------------------------------------------

async function runPurge(path: string): Promise<number> {
  const artifact = await readArtifact(path);
  const decisions = planPurge(artifact.items, await pointers.read(artifact.items.map((i) => i.id)));
  const purges = decisions.filter((d) => d.kind === "purge");
  console.log(`==> ${purges.length} replaced photo(s) to delete from gs://${bucketName}.`);
  for (const d of decisions) {
    if (d.kind === "keep") {
      console.log(`  keep #${d.item.id}: ${d.reason}`);
    }
  }
  if (dryRun) {
    console.log("==> [dry-run] Deleted nothing.");
    return 0;
  }
  const result = await executePurge(decisions, images);
  console.log(`==> Purge recorded in ${await writeRecord(path, "purge", result)}`);
  for (const error of result.errors) {
    console.error(`  ERROR ${error}`);
  }
  console.log(
    `==> Deleted the replaced photo pair for ${result.purged.length} profile(s); ${result.errors.length} failed.`,
  );
  return result.errors.length > 0 ? 1 : 0;
}

const run = { plan: runUpload, undo: runUndo, purge: runPurge }[mode];
process.exit(await run(values[mode] as string));
