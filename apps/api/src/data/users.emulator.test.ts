import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { addStar, ensureUser, getUser, removeStar } from "./users.js";

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

  it("addStar/removeStar mutate only the stars field and are idempotent (R17/D106)", async () => {
    await db.collection("users").doc("5903").set({ id: 5903, role: "manager", stars: [] });

    expect(await addStar(db, 5903, 5012)).toEqual([5012]);
    // arrayUnion: a repeat add is a no-op, not a duplicate.
    expect(await addStar(db, 5903, 5012)).toEqual([5012]);
    expect(await addStar(db, 5903, 5305)).toEqual([5012, 5305]);

    // The write is scoped to `stars` — role and id are untouched (D106).
    expect(await getUser(db, 5903)).toEqual({ id: 5903, role: "manager", stars: [5012, 5305] });

    expect(await removeStar(db, 5903, 5012)).toEqual([5305]);
    // arrayRemove: removing an absent id is a no-op.
    expect(await removeStar(db, 5903, 5012)).toEqual([5305]);
  });

  it("addStar creates a minimal brother record when the user doc is absent", async () => {
    expect(await addStar(db, 5904, 5012)).toEqual([5012]);
    expect(await getUser(db, 5904)).toEqual({ id: 5904, role: "brother", stars: [5012] });
  });
});
