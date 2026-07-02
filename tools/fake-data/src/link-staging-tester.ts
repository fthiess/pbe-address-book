/**
 * Link a real Ghost member email to a fake STAGING profile, so a real person can
 * sign in through the real Ghost bridge and land on a fake record (the D72
 * full-fidelity auth test). Staging holds fake data only, so none of the fake
 * brothers carry a real email; this script overwrites one fake profile's `email`
 * with the tester's real address and grants that profile the `admin` role.
 *
 * Guarded exactly like `seed-staging.ts` — it refuses unless the target project
 * id ends with "-staging" and refuses if pointed at the emulator — so it can
 * never touch production or real data.
 *
 * Usage (from the repo root, after `gcloud auth application-default login` and
 * after `npm run seed:staging`):
 *   GOOGLE_CLOUD_PROJECT=pbe-book-staging \
 *   STAGING_TESTER_EMAIL=you@example.com \
 *   npm run link:staging-tester --workspace tools/fake-data
 *
 * Optional: STAGING_TESTER_PROFILE_ID (Constitution id of the fake profile to
 * link; defaults to 5001).
 *
 * Flags: `--help` prints usage; `--dry-run` previews the exact writes (email,
 * privacy/visibility fields, and the admin grant) without touching Firestore
 * (CLAUDE.md CLI rule; OFC-79).
 *
 * NOTE: the API builds its email index at cold-start hydration, so let the
 * staging instance cold-start (or redeploy) after running this, or it will not
 * yet resolve the new email.
 */
import type { Profile } from "@pbe/shared";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function printHelp(): void {
  console.log(
    [
      "link:staging-tester — point a real Ghost member email at a fake STAGING",
      "                      profile and grant it admin, for real-bridge auth UAT (D72).",
      "",
      "Usage:",
      "  GOOGLE_CLOUD_PROJECT=<project>-staging STAGING_TESTER_EMAIL=you@example.com \\",
      "    npm run link:staging-tester --workspace tools/fake-data [-- --dry-run]",
      "",
      "Options:",
      "  --dry-run   Report the exact writes (email, share/visibility fields, admin",
      "              grant); make NO changes.",
      "  --help,-h   Show this help and exit.",
      "",
      "Required env:",
      "  GOOGLE_CLOUD_PROJECT (or GCLOUD_PROJECT)  Target project id; MUST end `-staging`.",
      "  STAGING_TESTER_EMAIL                       Real Ghost member email to link.",
      "Optional env:",
      "  STAGING_TESTER_PROFILE_ID                  Fake profile id to link (default 5001).",
      "Refuses to run if FIRESTORE_EMULATOR_HOST is set.",
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
const email = process.env.STAGING_TESTER_EMAIL;
const profileId = Number(process.env.STAGING_TESTER_PROFILE_ID ?? "5001");

if (!projectId) {
  console.error("Refusing: set GOOGLE_CLOUD_PROJECT to the staging project id.");
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing: FIRESTORE_EMULATOR_HOST is set (that targets the emulator).");
  process.exit(1);
}
if (!projectId.endsWith("-staging")) {
  console.error(
    `Refusing: project "${projectId}" does not end with "-staging". This script only ever writes to a staging project (D72).`,
  );
  process.exit(1);
}
if (!email) {
  console.error("Refusing: set STAGING_TESTER_EMAIL to the real Ghost member email to link.");
  process.exit(1);
}
if (!Number.isInteger(profileId)) {
  console.error(
    `Refusing: STAGING_TESTER_PROFILE_ID "${process.env.STAGING_TESTER_PROFILE_ID}" is not an integer.`,
  );
  process.exit(1);
}

initializeApp({ projectId });
const db = getFirestore();

const profileRef = db.collection("profiles").doc(String(profileId));
const snapshot = await profileRef.get();
if (!snapshot.exists) {
  console.error(
    `Refusing: profile #${profileId} does not exist. Run \`npm run seed:staging\` first.`,
  );
  process.exit(1);
}

const profile = snapshot.data() as Profile;

if (DRY_RUN) {
  console.log(`[dry-run] Target project: ${projectId}`);
  console.log(
    `[dry-run] Would update profile #${profileId} ("${profile.firstName} ${profile.lastName}"): ` +
      `email=${email}, privacy.shareEmail=true, unlisted=false, deceased.isDeceased=false.`,
  );
  console.log(
    `[dry-run] Would grant admin: users/${profileId} merge { id: ${profileId}, role: "admin" }.`,
  );
  console.log("[dry-run] No changes were made.");
  process.exit(0);
}

// Make the linked profile a clean, visible, contactable record for the tester:
// a real email, the email share-toggle on, listed, and living (§3 field shape).
await profileRef.update({
  email,
  "privacy.shareEmail": true,
  unlisted: false,
  deceased: { isDeceased: false },
});
// Grant the linked profile the admin role so the tester can exercise everything.
// MERGE (not a full set) so the tester's existing `stars` survive — this script
// runs on every deploy (the N18 autoseed), and a full set would wipe the star
// list each time. An absent doc is created with just {id, role}; `getStars`
// treats a missing `stars` field as [], and the first star write creates it.
await db
  .collection("users")
  .doc(String(profileId))
  .set({ id: profileId, role: "admin" }, { merge: true });

console.log(
  `Linked ${email} → fake profile #${profileId} ("${profile.firstName} ${profile.lastName}") as admin in ${projectId}. Let the staging API cold-start (or redeploy) so it re-indexes the new email.`,
);
process.exit(0);
