import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureUser, getUser } from "./users.js";

const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!hasEmulator)("users collection (emulator)", () => {
  let db: Firestore;

  beforeAll(() => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();
  });

  it("getUser returns null for a brother who has never signed in", async () => {
    expect(await getUser(db, 5900)).toBeNull();
  });

  it("ensureUser creates a brother record on first sign-in (R20)", async () => {
    const record = await ensureUser(db, 5901);
    expect(record).toEqual({ id: 5901, role: "brother", stars: [] });
    expect(await getUser(db, 5901)).toEqual(record);
  });

  it("ensureUser preserves an existing record — it never resets role or stars", async () => {
    await db
      .collection("users")
      .doc("5902")
      .set({ id: 5902, role: "admin", stars: [5001] });
    const record = await ensureUser(db, 5902);
    expect(record).toEqual({ id: 5902, role: "admin", stars: [5001] });
  });
});
