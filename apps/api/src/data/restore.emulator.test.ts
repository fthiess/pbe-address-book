import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeProfile } from "../test-support/make-profile.js";
import type { BackupData } from "./backup.js";
import { FirestoreBackupSource } from "./backup.js";
import { ProfileCache } from "./cache.js";
import { FirestoreRestoreTarget, executeRestore } from "./restore-executor.js";
import { RESTORE_COLLECTIONS, privilegedRoster, validateSnapshot } from "./restore.js";

// This suite only runs under the Firestore emulator (set by emulators:exec).
// Guard so a stray direct run can never touch a real Firestore.
const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

/**
 * The restore against real Firestore — reserved, as the emulator suite always is,
 * for what an in-memory double cannot honestly prove: that batched deletes and
 * `set()`s land the replacement semantics the plan describes, and that Book's own
 * cold-start hydration then reads the restored data back. That last step is the
 * **hydrate-and-count smoke check** D102's integrity job is defined around, so this
 * is also 7b-4's rehearsal.
 */

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

describe.skipIf(!hasEmulator)("offline restore (emulator)", () => {
  let db: Firestore;

  beforeEach(async () => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();
    await wipe(db);
    // The "before" state: two brothers, a stars doc, and a banner — none of which
    // the snapshot below names, except #5001 under changed contents.
    const batch = db.batch();
    // Distinct addresses throughout: `makeProfile` defaults every record to the
    // same exemplar email, and two records sharing one is precisely what the
    // validator refuses (D97's single namespace), so a lazy fixture would fail the
    // round-trip test for a reason that has nothing to do with the restore.
    batch.set(
      db.collection("profiles").doc("5001"),
      makeProfile({ id: 5001, classYear: 1984, email: "b5001@example.test" }),
    );
    batch.set(
      db.collection("profiles").doc("5002"),
      makeProfile({ id: 5002, role: "admin", email: "b5002@example.test" }),
    );
    batch.set(db.collection("users").doc("5002"), { id: 5002, stars: [5001] });
    batch.set(db.collection("config").doc("systemBanner"), {
      active: true,
      message: "before",
      severity: "info",
      updatedBy: 5002,
      updatedAt: "2026-06-03T12:00:00.000Z",
    });
    await batch.commit();
  });

  afterAll(async () => {
    await wipe(db);
  });

  const snapshot = (): BackupData => ({
    profiles: [
      {
        id: "5001",
        data: { ...makeProfile({ id: 5001, classYear: 1985, email: "b5001@example.test" }) },
      },
      {
        id: "5247",
        data: { ...makeProfile({ id: 5247, role: "admin", email: "b5247@example.test" }) },
      },
    ],
    users: [{ id: "5247", data: { id: 5247, stars: [5001] } }],
    config: [
      {
        id: "systemBanner",
        data: {
          active: false,
          message: "after",
          severity: "info",
          updatedBy: 5247,
          updatedAt: "2026-07-25T12:00:00.000Z",
        },
      },
    ],
  });

  it("leaves Firestore holding exactly the snapshot, stale documents removed", async () => {
    const target = new FirestoreRestoreTarget(db);
    const plan = await executeRestore(target, snapshot());

    expect(plan.totalWrites).toBe(4);
    // #5002 (profile) and its stars doc are absent from the snapshot, so both go.
    expect(plan.totalDeletes).toBe(2);

    const after = await new FirestoreBackupSource(db).export();
    expect(after.profiles.map((doc) => doc.id).sort()).toEqual(["5001", "5247"]);
    expect(after.users.map((doc) => doc.id)).toEqual(["5247"]);
    expect(after.profiles.find((doc) => doc.id === "5001")?.data.classYear).toBe(1985);
    expect(after.config[0]?.data.message).toBe("after");
  });

  it("round-trips: the restored data re-exports as a snapshot that still validates", async () => {
    await executeRestore(new FirestoreRestoreTarget(db), snapshot());
    const report = validateSnapshot(await new FirestoreBackupSource(db).export());
    expect(report.errors).toEqual([]);
    expect(report.counts.profiles).toBe(2);
  });

  it("hydrates and counts — the smoke check the integrity job (D102) runs", async () => {
    await executeRestore(new FirestoreRestoreTarget(db), snapshot());

    const cache = new ProfileCache();
    await cache.hydrateFromFirestore(db);

    expect(cache.size).toBe(2);
    expect(cache.getById(5001)?.classYear).toBe(1985);
    expect(cache.getById(5002)).toBeNull();
    // The roster the forensic entry claimed is the roster Book actually holds —
    // the property that makes the audit entry trustworthy rather than adjacent.
    const roster = privilegedRoster(
      await new FirestoreBackupSource(db).export().then((d) => d.profiles),
    );
    expect(roster.adminIds).toEqual([5247]);
    expect(cache.adminCount()).toBe(roster.usableAdminIds.length);
  });

  it("re-running is idempotent — a partially failed restore converges on a retry", async () => {
    const target = new FirestoreRestoreTarget(db);
    await executeRestore(target, snapshot());
    const second = await executeRestore(target, snapshot());
    expect(second.totalDeletes).toBe(0);
    const after = await new FirestoreBackupSource(db).export();
    expect(after.profiles).toHaveLength(2);
  });
});
