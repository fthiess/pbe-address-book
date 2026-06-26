import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateProfiles } from "./generate.js";

// This suite only runs under the Firestore emulator (set by emulators:exec).
// Guard so a stray direct run can never touch a real Firestore.
const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!hasEmulator)(
  "seeding the deterministic dataset into the Firestore emulator",
  () => {
    let db: Firestore;
    const collectionName = "profiles_emulator_test";

    beforeAll(() => {
      if (getApps().length === 0) {
        initializeApp({ projectId: "demo-pbe-book" });
      }
      db = getFirestore();
    });

    afterAll(async () => {
      const snapshot = await db.collection(collectionName).get();
      const batch = db.batch();
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    });

    it("writes a deterministic batch and reads it back unchanged", async () => {
      const profiles = generateProfiles({ count: 25, seed: 1 });
      const collection = db.collection(collectionName);

      const writeBatch = db.batch();
      for (const profile of profiles) {
        writeBatch.set(collection.doc(String(profile.id)), profile);
      }
      await writeBatch.commit();

      const snapshot = await collection.get();
      expect(snapshot.size).toBe(25);

      const firstDoc = await collection.doc("5001").get();
      expect(firstDoc.exists).toBe(true);
      expect(firstDoc.data()).toEqual(profiles[0]);
    });
  },
);
