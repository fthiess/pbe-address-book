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
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   GOOGLE_CLOUD_PROJECT=pbe-book-staging npm run seed:staging --workspace tools/fake-data
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { generateProfiles } from "./generate.js";

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

const profiles = generateProfiles();
const BATCH_LIMIT = 450; // under Firestore's 500-writes-per-batch ceiling

let written = 0;
for (let start = 0; start < profiles.length; start += BATCH_LIMIT) {
  const slice = profiles.slice(start, start + BATCH_LIMIT);
  const batch = db.batch();
  for (const profile of slice) {
    batch.set(db.collection("profiles").doc(profile.id), profile);
  }
  await batch.commit();
  written += slice.length;
  console.log(`  …wrote ${written}/${profiles.length}`);
}

console.log(
  `Seeded ${profiles.length} fake profiles into staging Firestore (project ${projectId}).`,
);
process.exit(0);
