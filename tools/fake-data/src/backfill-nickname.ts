/**
 * One-off STAGING backfill: copy each profile's `mugName` into its empty
 * `nickname` (OFC-409).
 *
 * WHY THIS EXISTS. OFC-409 splits the old single field in two and moves the name
 * quoted under the Canonical Name from `mugName` to `nickname`. `nickname` ships
 * empty for every record, so without this the quoted name simply **disappears from
 * every profile on staging** in the last days of the UAT window — a visible
 * regression that testers would rightly report as a bug. Copying the existing mug
 * names forward restores the display and, incidentally, shows testers what the new
 * Nickname field is for.
 *
 * ⚠ **STAGING AND TEST DATA ONLY.** Production deliberately leaves `nickname`
 * blank and lets brothers fill it in over time (Forrest's call) — a real brother's
 * mug name may be a joke he would not want used as a name for him, which is the
 * entire reason OFC-409 split the fields. The `-staging` project-id guard below is
 * what enforces that; do not weaken it, and do not "finish the job" at cutover.
 *
 * ⚠ **`lastModified` IS PRESERVED** (Forrest's call). A bulk write that bumped it
 * would make every profile on staging look freshly edited, disturbing the "Last
 * updated" column and the verification-staleness filter that managers are testing.
 * `newsletterConsentChangedAt` is untouched for the same reason — nothing here
 * changes consent. This is the one place in the codebase that writes a profile
 * without advancing `lastModified`, and it is deliberate.
 *
 * SAFETY PROPERTIES:
 *  - **additive only** — writes exactly one field, `nickname`, and never deletes;
 *  - **never overwrites** — skips any record that already has a non-empty
 *    `nickname`, so a brother who has set his own keeps it;
 *  - **idempotent** — a second run finds nothing left to do;
 *  - **no-op without a mug name** — a record with no `mugName` is left alone.
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   GOOGLE_CLOUD_PROJECT=pbe-book-staging \
 *     npm run backfill:nickname --workspace tools/fake-data -- --dry-run
 * then re-run without `--dry-run` to apply.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function printHelp(): void {
  console.log(
    [
      "backfill:nickname — copy `mugName` into an empty `nickname` on STAGING (OFC-409)",
      "",
      "Usage:",
      "  GOOGLE_CLOUD_PROJECT=<project>-staging \\",
      "    npm run backfill:nickname --workspace tools/fake-data [-- --dry-run]",
      "",
      "Options:",
      "  --dry-run   Report what would change; make NO changes.",
      "  --help,-h   Show this help and exit.",
      "",
      "Required env:",
      "  GOOGLE_CLOUD_PROJECT (or GCLOUD_PROJECT)  Target project id; MUST end in",
      "                                            `-staging` (guards production).",
      "Refuses to run if FIRESTORE_EMULATOR_HOST is set.",
      "",
      "Never overwrites an existing nickname; preserves lastModified; idempotent.",
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
  console.error("Refusing to run: set GOOGLE_CLOUD_PROJECT to the staging project id.");
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST is set (that targets the emulator).");
  process.exit(1);
}
if (!projectId.endsWith("-staging")) {
  console.error(
    `Refusing to run: project "${projectId}" does not end with "-staging". This backfill only ever touches staging test data (OFC-409); production keeps \`nickname\` empty by design.`,
  );
  process.exit(1);
}

initializeApp({ projectId });
const db = getFirestore();

const BATCH_LIMIT = 450; // under Firestore's 500-writes-per-batch ceiling

/**
 * Whether a stored value counts as an already-filled nickname. Whitespace-only is
 * treated as empty: it displays as nothing, so leaving it in place would defeat
 * the backfill for exactly the records that look emptiest.
 */
function isFilled(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

async function main(): Promise<void> {
  const snapshot = await db.collection("profiles").get();

  const pending: { id: string; nickname: string }[] = [];
  let alreadySet = 0;
  let noMugName = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (isFilled(data.nickname)) {
      alreadySet++;
      continue;
    }
    if (!isFilled(data.mugName)) {
      noMugName++;
      continue;
    }
    pending.push({ id: doc.id, nickname: (data.mugName as string).trim() });
  }

  // Counts and ids only — never a stored name. The staging set is fake, but the
  // tester rows at #9001+ are real people, and this output can land in a terminal
  // log or a PR body (CLAUDE.md: no real member PII, anywhere).
  console.log(
    `profiles: ${snapshot.size} | to backfill: ${pending.length} | nickname already set: ${alreadySet} | no mug name: ${noMugName}`,
  );

  if (pending.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (DRY_RUN) {
    console.log("--dry-run: no changes written.");
    return;
  }

  for (let start = 0; start < pending.length; start += BATCH_LIMIT) {
    const batch = db.batch();
    for (const entry of pending.slice(start, start + BATCH_LIMIT)) {
      // `update` with a single field — NOT `set`, which would need the whole doc,
      // and deliberately no `lastModified` touch (see the module note).
      batch.update(db.collection("profiles").doc(entry.id), { nickname: entry.nickname });
    }
    await batch.commit();
  }

  console.log(`Backfilled ${pending.length} profile(s). lastModified left untouched.`);
  console.log("⚠ The API caches the roster at cold start — force one to see the change.");
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
