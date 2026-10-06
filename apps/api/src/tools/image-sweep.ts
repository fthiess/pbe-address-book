#!/usr/bin/env tsx
/**
 * images:sweep — delete the live image objects no profile points at (OFC-463,
 * which folded in OFC-448; D195). The why, and the upload race it guards against,
 * are in `image-sweep-plan.ts`.
 *
 * Two steps, so what is deleted is exactly what was reviewed:
 *   1. `--plan`   Lists the bucket and reads every profile's photo pointer; writes
 *                 `restore-artifacts/image-sweep-plan-<timestamp>.json` naming each
 *                 orphan and its generation. Changes nothing.
 *   2. `--apply <plan> --confirm <project>`  Re-reads the pointers and deletes each
 *                 planned object that is still unreferenced, at exactly the planned
 *                 generation (a rewritten object is skipped).
 *
 * Needs no maintenance window and no cold start: it deletes only objects nothing
 * references, and touches no Firestore document. Each delete leaves a noncurrent
 * version the bucket keeps 90 days (D94) — the plan file's generations are the undo.
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   npm run images:sweep --workspace apps/api -- --project <id> --bucket <name> --plan
 *   npm run images:sweep --workspace apps/api -- --project <id> --bucket <name> \
 *     --apply <plan> (--dry-run | --confirm <id>)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import {
  type LiveObject,
  type Orphan,
  type PointerMap,
  orphanReason,
  planSweep,
} from "./image-sweep-plan.js";

const TOOL = "image-sweep";
const DEFAULT_OUT_DIR = "restore-artifacts";
/** The image-key prefixes (`@pbe/shared` images.ts). */
const PREFIXES = ["headshots/", "thumbnails/"] as const;
/** Objects younger than this are never planned for deletion (an upload may be mid-flight). */
const MIN_AGE_MS = 60 * 60 * 1000;

function printHelp(): void {
  console.log(
    [
      "images:sweep — delete live image objects no profile points at (D195).",
      "",
      "Usage:",
      "  npm run images:sweep --workspace apps/api -- --project <id> --bucket <name> --plan",
      "  npm run images:sweep --workspace apps/api -- --project <id> --bucket <name> \\",
      "      --apply <plan> (--dry-run | --confirm <id>)",
      "",
      "Options:",
      "  --project <id>   Target GCP project.",
      "  --bucket <name>  The environment's private image bucket (IMAGE_BUCKET).",
      "  --plan           List orphans and write a plan file; changes nothing.",
      "  --apply <plan>   Delete the planned orphans that are still unreferenced.",
      "  --confirm <id>   Must equal --project. Required to delete anything.",
      "  --dry-run        With --apply: report what would be deleted; delete nothing.",
      "  --out <dir>      Where the plan and record go (default restore-artifacts/).",
      "  --help, -h       Show this help and exit.",
    ].join("\n"),
  );
}

function fail(message: string): never {
  console.error(`${TOOL}: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}
const values: Record<string, string> = {};
const flags = new Set<string>();
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg === "--plan" || arg === "--dry-run") {
    flags.add(arg);
    continue;
  }
  if (!["--project", "--bucket", "--apply", "--confirm", "--out"].includes(arg)) {
    fail(`unknown argument ${arg} (see --help).`);
  }
  const value = args[++i];
  if (value === undefined || value.startsWith("--")) {
    fail(`${arg} needs a value.`);
  }
  values[arg.slice(2)] = value;
}
const projectId: string = values.project ?? fail("--project is required.");
const bucketName: string = values.bucket ?? fail("--bucket is required.");
if (flags.has("--plan") === (values.apply !== undefined)) {
  fail("pass exactly one of --plan or --apply <plan>.");
}
const dryRun = flags.has("--dry-run");
if (values.apply !== undefined && !dryRun && values.confirm !== projectId) {
  fail(`refusing to delete: pass --confirm ${projectId} (or --dry-run).`);
}
const outDir = resolve(values.out ?? DEFAULT_OUT_DIR);
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");

initializeApp({ projectId });
const bucket = getStorage().bucket(bucketName);

/** Every profile's current photo pointer, read from Firestore (not a cache). */
async function readPointers(): Promise<PointerMap> {
  const snapshot = await getFirestore()
    .collection("profiles")
    .select("id", "hasHeadshot", "headshotVersion")
    .get();
  const pointers = new Map<number, string | null>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const id = typeof data.id === "number" ? data.id : Number(doc.id);
    pointers.set(
      id,
      data.hasHeadshot === true && typeof data.headshotVersion === "string"
        ? data.headshotVersion
        : null,
    );
  }
  return pointers;
}

interface PlanFile {
  tool: typeof TOOL;
  projectId: string;
  bucket: string;
  plannedAt: string;
  orphans: Orphan[];
}

async function runPlan(): Promise<number> {
  const objects: LiveObject[] = [];
  for (const prefix of PREFIXES) {
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) {
      objects.push({
        key: file.name,
        generation: String(file.metadata.generation ?? ""),
        created: String(file.metadata.timeCreated ?? ""),
      });
    }
  }
  const pointers = await readPointers();
  const plan = planSweep(objects, pointers, new Date(), MIN_AGE_MS);
  const byReason = (r: Orphan["reason"]) => plan.orphans.filter((o) => o.reason === r).length;
  console.log(
    `==> ${objects.length} live object(s) in gs://${bucketName}: ${plan.referenced} referenced, ` +
      `${plan.orphans.length} orphaned (${byReason("no-profile")} at an id with no profile, ` +
      `${byReason("not-current")} not the profile's current photo), ${plan.tooNew.length} too new to judge.`,
  );
  for (const key of plan.unrecognized) {
    console.log(`  NOTE ${key}: not a well-formed image key — left alone.`);
  }
  for (const key of plan.missing) {
    console.log(`  WARN ${key}: a profile points at it but it does not exist.`);
  }
  await mkdir(outDir, { recursive: true });
  const path = resolve(outDir, `${TOOL}-plan-${stamp}.json`);
  const file: PlanFile = {
    tool: TOOL,
    projectId,
    bucket: bucketName,
    plannedAt: new Date().toISOString(),
    orphans: plan.orphans,
  };
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`==> Plan: ${path}`);
  console.log("    Review it, then --apply it with --confirm. Nothing was deleted.");
  return 0;
}

/** Delete one planned orphan if it is still unreferenced, at exactly its planned generation. */
async function deleteOrphan(orphan: Orphan, pointers: PointerMap): Promise<string> {
  if (orphanReason(orphan.key, pointers) === null) {
    return "now-referenced";
  }
  if (dryRun) {
    return "would-delete";
  }
  try {
    await bucket.file(orphan.key).delete({ ifGenerationMatch: orphan.generation });
    return "deleted";
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 404) {
      return "already-gone";
    }
    if (code === 412) {
      return "rewritten-since-plan";
    }
    console.error(`  ERROR ${orphan.key}: ${(error as Error).message}`);
    return "failed";
  }
}

async function runApply(planPath: string): Promise<number> {
  let plan: PlanFile;
  try {
    plan = JSON.parse(await readFile(resolve(planPath), "utf8")) as PlanFile;
  } catch (error) {
    fail(`cannot read the plan ${resolve(planPath)}: ${(error as Error).message}`);
  }
  if (plan?.tool !== TOOL || !Array.isArray(plan.orphans)) {
    fail(`${planPath} is not an ${TOOL} plan.`);
  }
  if (plan.projectId !== projectId || plan.bucket !== bucketName) {
    fail(
      `${planPath} was planned for ${plan.projectId} / ${plan.bucket}, not ${projectId} / ${bucketName}.`,
    );
  }
  // Re-read now: a pointer may have moved onto one of these since the plan.
  const pointers = await readPointers();
  const outcomes: { key: string; generation: string; outcome: string }[] = [];
  let errors = 0;
  for (const orphan of plan.orphans) {
    const outcome = await deleteOrphan(orphan, pointers);
    if (outcome === "failed") {
      errors++;
    }
    outcomes.push({ key: orphan.key, generation: orphan.generation, outcome });
  }
  const tally = new Map<string, number>();
  for (const o of outcomes) {
    tally.set(o.outcome, (tally.get(o.outcome) ?? 0) + 1);
  }
  console.log(
    `==> ${dryRun ? "[dry-run] " : ""}${plan.orphans.length} planned: ${[...tally].map(([k, n]) => `${n} ${k}`).join(", ") || "nothing"}.`,
  );
  if (!dryRun) {
    const path = resolve(outDir, `${TOOL}-apply-${stamp}.json`);
    await mkdir(outDir, { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ tool: TOOL, kind: "apply", projectId, bucket: bucketName, of: resolve(planPath), at: new Date().toISOString(), outcomes }, null, 2)}\n`,
    );
    console.log(`==> Record (the generations are the undo for 90 days): ${path}`);
  }
  return errors > 0 ? 1 : 0;
}

process.exit(flags.has("--plan") ? await runPlan() : await runApply(values.apply as string));
