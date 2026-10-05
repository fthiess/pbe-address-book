import { getApps, initializeApp } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type BackupData, buildBackupSnapshot } from "../data/backup.js";
import { FirestoreRestoreTarget, executeRestore } from "../data/restore-executor.js";
import { RESTORE_COLLECTIONS, parseSnapshot, validateSnapshot } from "../data/restore.js";
import { makeProfile } from "../test-support/make-profile.js";
import { openFirestore } from "./backup-io.js";
import { readRestoredState } from "./verify-backup-state.js";
import { DEFAULT_MAX_AGE_HOURS, runChecks } from "./verify-backup-support.js";

// This suite only runs under the Firestore emulator (set by emulators:exec).
// Guard so a stray direct run can never touch a real Firestore.
const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

/**
 * The integrity job's data plane (D102/D151) against real Firestore: a restore into
 * a **named** database, then the check that reads it back. Two things here no
 * in-memory double can prove. First, that `--database` really isolates — D151 put
 * the throwaway database in its own project precisely because "a bug in the new
 * `--database` flag could then overwrite the environment the job exists to
 * protect", and the emulator is where that bug would show. Second, that the
 * content comparison survives a genuine Firestore round trip (map key order, number
 * types, nested maps) without false alarms — a check that cries wolf on every run
 * gets switched off. The named database is created implicitly on first reference,
 * as the emulator documents (firebase.google.com/docs/emulator-suite/connect_firestore).
 */

const NAMED = "verify-run-test";

async function wipe(db: Firestore): Promise<void> {
  for (const collection of RESTORE_COLLECTIONS) {
    const snapshot = await db.collection(collection).get();
    if (snapshot.empty) {
      continue;
    }
    const batch = db.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}

function backup(): BackupData {
  return {
    profiles: [
      {
        id: "5001",
        data: {
          ...makeProfile({ id: 5001, classYear: 1985, email: "b5001@example.test" }),
          // A nested map and a float, so the round trip is exercised where Firestore
          // could plausibly reshape a value.
          location: { lat: 42.3601, lng: -71.0942, label: "Cambridge" },
        },
      },
      {
        id: "5247",
        data: {
          ...makeProfile({
            id: 5247,
            role: "admin",
            email: "b5247@example.test",
            hasHeadshot: true,
            headshotVersion: "v3",
          }),
        },
      },
    ],
    users: [{ id: "5247", data: { id: 5247, stars: [5001] } }],
    config: [{ id: "systemBanner", data: { active: false, message: "", severity: "info" } }],
  };
}

describe.skipIf(!hasEmulator)("backup integrity check (emulator)", () => {
  let live: Firestore;
  let named: Firestore;

  beforeEach(async () => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    live = openFirestore(null);
    named = openFirestore(NAMED);
    await wipe(live);
    await wipe(named);
    // The "environment the job protects": one record the backup does NOT carry.
    await live
      .collection("profiles")
      .doc("6001")
      .set(makeProfile({ id: 6001, email: "b6001@example.test" }));
  });

  afterAll(async () => {
    await wipe(live);
    await wipe(named);
  });

  const snapshot = () => {
    const parsed = parseSnapshot(
      JSON.parse(JSON.stringify(buildBackupSnapshot(backup(), new Date()))),
    );
    if (!parsed.ok) {
      throw new Error("fixture snapshot failed to parse");
    }
    return parsed.snapshot;
  };

  const verify = async () => {
    const parsed = snapshot();
    return runChecks({
      snapshot: parsed,
      validation: validateSnapshot(parsed.collections),
      restored: await readRestoredState(named),
      imageKeys: new Set(["headshots/5247/v3.webp", "thumbnails/5247/v3.webp"]),
      now: new Date(),
      maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    });
  };

  it("restores into the named database and leaves the default one untouched", async () => {
    await executeRestore(new FirestoreRestoreTarget(named), snapshot().collections);

    const namedIds = (await named.collection("profiles").get()).docs.map((d) => d.id).sort();
    expect(namedIds).toEqual(["5001", "5247"]);
    // The restore replaces — it deletes what the snapshot lacks. Had `--database`
    // leaked to the default database, #6001 would be gone and #5001/#5247 present.
    const liveIds = (await live.collection("profiles").get()).docs.map((d) => d.id);
    expect(liveIds).toEqual(["6001"]);
    expect((await live.collection("users").get()).empty).toBe(true);
  });

  it("verifies a genuine restore, with no false alarm from the round trip", async () => {
    await executeRestore(new FirestoreRestoreTarget(named), snapshot().collections);
    const verdict = await verify();
    expect(verdict.checks.filter((check) => !check.ok)).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("catches a restored database that drifted from its snapshot", async () => {
    await executeRestore(new FirestoreRestoreTarget(named), snapshot().collections);
    await named.collection("profiles").doc("5001").update({ classYear: 1986 });
    await named.collection("users").doc("5247").delete();

    const verdict = await verify();
    expect(verdict.ok).toBe(false);
    expect(verdict.checks.filter((check) => !check.ok).map((check) => check.name)).toEqual([
      "profilesRestored",
      "usersRestored",
    ]);
  });

  it("catches a restore that hydrates to a different roster", async () => {
    await executeRestore(new FirestoreRestoreTarget(named), snapshot().collections);
    await named.collection("profiles").doc("5247").update({ role: "brother" });

    const failed = (await verify()).checks.filter((check) => !check.ok).map((c) => c.name);
    expect(failed).toEqual(["profilesRestored", "hydratesAndCounts"]);
  });
});
