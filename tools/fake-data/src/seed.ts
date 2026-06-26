/**
 * Seed the deterministic fake dataset into the Firestore emulator.
 *
 * Safety: this script REFUSES to run unless `FIRESTORE_EMULATOR_HOST` is set,
 * so it can only ever write to the local emulator — fake data must never reach
 * a real Firestore (DECISIONS D65). Run it via the repo root `npm run seed`,
 * which wraps it in `firebase emulators:exec` (that command sets the env var).
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { generateProfiles } from "./generate.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorHost) {
  console.error(
    "Refusing to seed: FIRESTORE_EMULATOR_HOST is not set. This script only ever " +
      "writes to the Firestore emulator (run `npm run seed` from the repo root).",
  );
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "demo-pbe-book";

initializeApp({ projectId });
const db = getFirestore();

const profiles = generateProfiles();
const BATCH_LIMIT = 450; // under Firestore's 500-writes-per-batch ceiling

let written = 0;
for (let start = 0; start < profiles.length; start += BATCH_LIMIT) {
  const slice = profiles.slice(start, start + BATCH_LIMIT);
  const batch = db.batch();
  for (const profile of slice) {
    // The Firestore document key is the Constitution ID as a string (§2).
    batch.set(db.collection("profiles").doc(String(profile.id)), profile);
  }
  await batch.commit();
  written += slice.length;
  console.log(`  …wrote ${written}/${profiles.length}`);
}

console.log(
  `Seeded ${profiles.length} fake profiles into the Firestore emulator at ${emulatorHost} (project ${projectId}).`,
);
process.exit(0);
