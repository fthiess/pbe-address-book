import { getApps, initializeApp } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type BackupData, FirestoreBackupSource } from "../data/backup.js";
import { ProfileCache } from "../data/cache.js";
import { FirestoreRestoreTarget, executeRestore } from "../data/restore-executor.js";
import { RESTORE_COLLECTIONS } from "../data/restore.js";
import { makeProfile } from "../test-support/make-profile.js";
import { openFirestore } from "./backup-io.js";
import { renumberSnapshot } from "./renumber-plan.js";

// This suite only runs under the Firestore emulator (set by emulators:exec).
const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

/**
 * The renumber's data path end to end against real Firestore (OFC-463, D195): a
 * database with a gap is exported, transformed, and put back through the restore
 * executor, and then Book's own cold-start hydration reads it. The point is the
 * last step — `hydrateFromFirestore` keys the cache on `data.id` while every write
 * goes to `doc(String(id))`, so a transform that moved one without the other would
 * restore cleanly and then fork records on the first edit. Runs in its own named
 * database so it can never disturb the other suites' default one.
 */

const NAMED = "renumber-test";

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

/** #5003 was deleted (the gap); #5004–#5006 must move down one. */
function withGap(): BackupData {
  const p = (id: number, extra: Record<string, unknown> = {}) => ({
    id: String(id),
    data: { ...makeProfile({ id, email: `b${id}@example.test` }), ...extra },
  });
  return {
    profiles: [
      p(5001, { role: "admin" }),
      p(5002, { bigBrotherId: 5001 }),
      p(5004, { bigBrotherId: 5002, verifiedBy: 5004 }),
      p(5005, { bigBrotherId: 5004 }),
      p(5006, { bigBrotherId: 5005, hasHeadshot: true, headshotVersion: "v1" }),
    ],
    users: [
      { id: "5001", data: { id: 5001, stars: [5006] } },
      { id: "5005", data: { id: 5005, stars: [] } },
    ],
    config: [
      {
        id: "systemBanner",
        data: { active: false, message: "", severity: "info", updatedBy: 5001, updatedAt: "x" },
      },
    ],
  };
}

describe.skipIf(!hasEmulator)("renumber through the restore (emulator)", () => {
  let db: Firestore;

  beforeEach(async () => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = openFirestore(NAMED);
    await wipe(db);
    await executeRestore(new FirestoreRestoreTarget(db), withGap());
  });

  afterAll(async () => {
    await wipe(db);
  });

  it("closes the gap so the cold-start cache serves each brother at his new id", async () => {
    const exported = await new FirestoreBackupSource(db).export();
    const result = renumberSnapshot(exported, { gap: 5003, expectShifted: 3 });
    if (!result.ok) {
      throw new Error(result.errors.join("\n"));
    }
    const plan = await executeRestore(new FirestoreRestoreTarget(db), result.collections);
    // Stale keys: the old top profile (#5006) and the moved users doc's old key (#5005).
    expect(plan.totalDeletes).toBe(2);

    const keys = (await db.collection("profiles").get()).docs.map((d) => d.id).sort();
    expect(keys).toEqual(["5001", "5002", "5003", "5004", "5005"]);
    const userKeys = (await db.collection("users").get()).docs.map((d) => d.id).sort();
    expect(userKeys).toEqual(["5001", "5004"]);

    const cache = new ProfileCache();
    await cache.hydrateFromFirestore(db);
    expect(cache.size).toBe(5);
    expect(cache.getById(5003)?.email).toBe("b5004@example.test");
    expect(cache.getById(5003)?.verifiedBy).toBe(5003);
    expect(cache.getById(5004)?.bigBrotherId).toBe(5003);
    expect(cache.getById(5005)).toMatchObject({
      email: "b5006@example.test",
      bigBrotherId: 5004,
      headshotVersion: "v1",
    });
    expect(cache.getById(5006)).toBeNull();
    expect((await db.collection("users").doc("5001").get()).data()?.stars).toEqual([5005]);
  });

  it("refuses a second run over the already-renumbered data", async () => {
    const exported = await new FirestoreBackupSource(db).export();
    const first = renumberSnapshot(exported, { gap: 5003, expectShifted: 3 });
    if (!first.ok) {
      throw new Error(first.errors.join("\n"));
    }
    await executeRestore(new FirestoreRestoreTarget(db), first.collections);
    // #5003 is occupied now, so re-running the same command cannot shift anyone twice.
    const again = renumberSnapshot(await new FirestoreBackupSource(db).export(), {
      gap: 5003,
      expectShifted: 3,
    });
    expect(again.ok).toBe(false);
  });
});
