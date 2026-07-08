import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeProfile } from "../test-support/make-profile.js";
import { ProfileCache } from "./cache.js";

// This suite only runs under the Firestore emulator (set by emulators:exec).
// Guard so a stray direct run can never touch a real Firestore.
const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

interface DecodedBody {
  profiles: Array<{ id: number }>;
  majors: unknown[];
}

describe.skipIf(!hasEmulator)("ProfileCache.hydrateFromFirestore (emulator)", () => {
  let db: Firestore;

  beforeAll(async () => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();

    // hydrateFromFirestore reads the real `profiles` collection — write a small
    // out-of-order set with one unlisted record so we can prove both the read
    // path and the projection.
    const batch = db.batch();
    for (const profile of [
      makeProfile({ id: 5003, unlisted: false }),
      makeProfile({ id: 5001, unlisted: false }),
      makeProfile({ id: 5002, unlisted: true }),
    ]) {
      batch.set(db.collection("profiles").doc(String(profile.id)), profile);
    }
    await batch.commit();
  });

  afterAll(async () => {
    const snapshot = await db.collection("profiles").get();
    const batch = db.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  });

  it("hydrates from Firestore, ordered by Constitution id, with the projection applied", async () => {
    const cache = new ProfileCache();
    await cache.hydrateFromFirestore(db);

    expect(cache.size).toBe(3);

    const body = JSON.parse(cache.brotherPayload().json) as DecodedBody;
    // Unlisted 5002 is projected away; the rest come back in id order.
    expect(body.profiles.map((p) => p.id)).toEqual([5001, 5003]);
  });
});

describe.skipIf(!hasEmulator)(
  "ProfileCache.hydrateFromFirestore — malformed records (OFC-91)",
  () => {
    let db: Firestore;

    beforeAll(async () => {
      if (getApps().length === 0) {
        initializeApp({ projectId: "demo-pbe-book" });
      }
      db = getFirestore();

      // A good record, a pre-Phase-2a-shaped record missing the required
      // `deceased`/`debrothered`/`privacy` sub-objects (the exact shape that used to
      // throw inside the projection and 500 the whole bulk read), and a document
      // with no usable Constitution id.
      await db
        .collection("profiles")
        .doc("5001")
        .set(makeProfile({ id: 5001 }));
      await db.collection("profiles").doc("5002").set({
        id: 5002,
        firstName: "Old",
        lastName: "Shape",
        classYear: 1970,
        hasHeadshot: false,
        unlisted: false,
        allowNewsletterEmail: true,
        allowShareWithMITAA: false,
        lastModified: "2026-01-01T00:00:00.000Z",
        newsletterConsentChangedAt: "2026-01-01T00:00:00.000Z",
      });
      await db.collection("profiles").doc("junk").set({ firstName: "No", lastName: "Id" });
    });

    afterAll(async () => {
      const snapshot = await db.collection("profiles").get();
      const batch = db.batch();
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    });

    it("degrades gracefully: fills defaults on a malformed record and drops the id-less doc", async () => {
      const cache = new ProfileCache();
      // The whole hydration must not throw on the malformed shapes.
      await expect(cache.hydrateFromFirestore(db)).resolves.toBeUndefined();

      // The id-less document is dropped; the good and normalized records survive.
      expect(cache.size).toBe(2);
      const normalized = cache.getById(5002);
      expect(normalized?.deceased).toEqual({ isDeceased: false });
      expect(normalized?.debrothered).toEqual({ isDebrothered: false });

      // The bulk projection now builds without throwing on the normalized record.
      const body = JSON.parse(cache.brotherPayload().json) as DecodedBody;
      expect(body.profiles.map((p) => p.id)).toEqual([5001, 5002]);
    });
  },
);
