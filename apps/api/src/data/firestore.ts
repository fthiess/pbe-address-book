import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

/**
 * Lazily initialize and return the Firestore client (Admin SDK).
 *
 * Credentials and project resolve entirely from the environment, so no key
 * file ever lives in this (public) repo — the design's no-static-keys posture
 * (ENGINEERING-DESIGN §2; DECISIONS D58):
 *  - On Cloud Run, Application Default Credentials and the project id are
 *    detected automatically from the runtime service account.
 *  - Locally and in CI, `FIRESTORE_EMULATOR_HOST` routes the Admin SDK to the
 *    Firestore emulator and `GCLOUD_PROJECT` names the demo project.
 *
 * The Admin SDK bypasses Firestore security rules by design: Book's clients
 * never touch Firestore directly — every read flows through this backend and
 * its privacy projection, and `firestore.rules` denies all direct client
 * access as a defense-in-depth backstop (ENGINEERING-DESIGN §2).
 */
export function getDb(): Firestore {
  if (getApps().length === 0) {
    const projectId =
      process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "demo-pbe-book";
    initializeApp({ projectId });
  }
  return getFirestore();
}
