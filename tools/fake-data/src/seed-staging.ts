/**
 * Seed the deterministic fake dataset into a STAGING Firestore.
 *
 * Staging holds fake data only (DECISIONS D72), so seeding it is expected — but
 * unlike `seed.ts` (which only ever writes to the emulator), this writes to a
 * REAL Firestore via Application Default Credentials. It is therefore guarded
 * hard against ever touching production:
 *   - refuses unless `GOOGLE_CLOUD_PROJECT` (or `GCLOUD_PROJECT`) is set AND
 *     ends with "-staging";
 *   - refuses if `FIRESTORE_EMULATOR_HOST` is set (use `npm run seed` for the
 *     emulator instead).
 *
 * Seeding is a **clean replace**, not a merge: it WIPES the `profiles`
 * collection first, then writes the generated set. A plain per-doc `set()` only
 * overwrites docs under matching keys, so if an older seed wrote a *different*
 * id keyspace (e.g. the pre-2a skeleton's `fake-5247` string ids vs. the
 * schema's numeric `5247`), those stale docs would survive and break cache
 * hydration — exactly the failure seen on the first Phase-2c staging deploy.
 * Wiping first makes the result a pure function of the generator, independent of
 * whatever the collection happened to hold (the same self-containment the
 * emulator seed enjoys by starting from an empty database).
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   GOOGLE_CLOUD_PROJECT=pbe-book-staging npm run seed:staging --workspace tools/fake-data
 *
 * Flags: `--help` prints usage; `--dry-run` previews the wipe + write counts
 * without touching Firestore (CLAUDE.md CLI rule; OFC-79).
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { generateProfiles } from "./generate.js";

function printHelp(): void {
  console.log(
    [
      "seed:staging — wipe and re-seed the STAGING Firestore `profiles` collection",
      "               with the deterministic fake dataset (D72).",
      "",
      "Usage:",
      "  GOOGLE_CLOUD_PROJECT=<project>-staging \\",
      "    npm run seed:staging --workspace tools/fake-data [-- --dry-run]",
      "",
      "Options:",
      "  --dry-run   Report how many docs would be wiped/written; make NO changes.",
      "  --help,-h   Show this help and exit.",
      "",
      "Required env:",
      "  GOOGLE_CLOUD_PROJECT (or GCLOUD_PROJECT)  Target project id; MUST end in",
      "                                            `-staging` (guards production).",
      "Refuses to run if FIRESTORE_EMULATOR_HOST is set (use `npm run seed`).",
    ].join("\n"),
  );
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;

if (!projectId) {
  console.error("Refusing to seed: set GOOGLE_CLOUD_PROJECT to the staging project id.");
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "Refusing to seed: FIRESTORE_EMULATOR_HOST is set (that targets the emulator). " +
      "Use `npm run seed` for the emulator.",
  );
  process.exit(1);
}
if (!projectId.endsWith("-staging")) {
  console.error(
    `Refusing to seed: project "${projectId}" does not end with "-staging". This script only ever writes fake data to a staging project (D72); it must never touch production.`,
  );
  process.exit(1);
}

initializeApp({ projectId });
const db = getFirestore();

const BATCH_LIMIT = 450; // under Firestore's 500-writes-per-batch ceiling

// Wipe the collection first so seeding is a clean replace, not a merge: any doc
// left from an earlier seed (including one under a different id keyspace) is
// removed, so a stale-schema record can never linger and crash hydration.
const existing = await db.collection("profiles").get();
const profiles = generateProfiles();

if (DRY_RUN) {
  const first = profiles[0]?.id;
  const last = profiles[profiles.length - 1]?.id;
  console.log(`[dry-run] Target project: ${projectId}`);
  console.log(`[dry-run] Would delete ${existing.size} existing profile doc(s).`);
  console.log(
    `[dry-run] Would write ${profiles.length} generated profiles (ids ${first}–${last}).`,
  );
  console.log("[dry-run] No changes were made.");
  process.exit(0);
}

if (!existing.empty) {
  let removed = 0;
  for (let start = 0; start < existing.size; start += BATCH_LIMIT) {
    const batch = db.batch();
    for (const doc of existing.docs.slice(start, start + BATCH_LIMIT)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    removed += Math.min(BATCH_LIMIT, existing.size - start);
    console.log(`  …wiped ${removed}/${existing.size} existing`);
  }
  console.log(`Cleared ${existing.size} existing profile docs before seeding.`);
}

let written = 0;
for (let start = 0; start < profiles.length; start += BATCH_LIMIT) {
  const slice = profiles.slice(start, start + BATCH_LIMIT);
  const batch = db.batch();
  for (const profile of slice) {
    batch.set(db.collection("profiles").doc(String(profile.id)), profile);
  }
  await batch.commit();
  written += slice.length;
  console.log(`  …wrote ${written}/${profiles.length}`);
}

console.log(
  `Seeded ${profiles.length} fake profiles into staging Firestore (project ${projectId}).`,
);
process.exit(0);
