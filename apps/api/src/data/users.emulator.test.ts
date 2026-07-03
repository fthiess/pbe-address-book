import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import {
  FirestoreAdminUserStore,
  LastAdminError,
  addStar,
  ensureUser,
  getUser,
  removeStar,
} from "./users.js";

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

describe.skipIf(!hasEmulator)("FirestoreAdminUserStore (emulator)", () => {
  let db: Firestore;
  let store: FirestoreAdminUserStore;

  beforeAll(() => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();
    store = new FirestoreAdminUserStore(db);
  });

  it("setRole creates the users doc if absent, reporting before = brother (N44)", async () => {
    const result = await store.setRole(5920, "manager");
    expect(result).toEqual({ before: "brother" });
    expect(await getUser(db, 5920)).toEqual({ id: 5920, role: "manager", stars: [] });
  });

  it("setRole updates an existing role scoped to `role`, preserving stars", async () => {
    await db
      .collection("users")
      .doc("5921")
      .set({ id: 5921, role: "brother", stars: [5001] });
    const result = await store.setRole(5921, "admin");
    expect(result).toEqual({ before: "brother" });
    expect(await getUser(db, 5921)).toEqual({ id: 5921, role: "admin", stars: [5001] });
  });

  it("setRole rejects demoting the only remaining admin (last-admin invariant)", async () => {
    // Establish a deterministic baseline against the shared emulator DB: clear every
    // existing admin, then seed exactly one.
    const existing = await db.collection("users").where("role", "==", "admin").get();
    await Promise.all(existing.docs.map((doc) => doc.ref.delete()));
    await db.collection("users").doc("5950").set({ id: 5950, role: "admin", stars: [] });

    // The only admin cannot be demoted.
    await expect(store.setRole(5950, "manager")).rejects.toBeInstanceOf(LastAdminError);
    expect((await getUser(db, 5950))?.role).toBe("admin");

    // With a second admin present, demoting one is allowed.
    await db.collection("users").doc("5951").set({ id: 5951, role: "admin", stars: [] });
    const ok = await store.setRole(5950, "manager");
    expect(ok.before).toBe("admin");
  });

  it("removeStarFromAll pulls the id from every user's stars (idempotent)", async () => {
    await db
      .collection("users")
      .doc("5930")
      .set({ id: 5930, role: "brother", stars: [7000, 7001] });
    await db
      .collection("users")
      .doc("5931")
      .set({ id: 5931, role: "manager", stars: [7000] });
    await store.removeStarFromAll(7000);
    expect((await getUser(db, 5930))?.stars).toEqual([7001]);
    expect((await getUser(db, 5931))?.stars).toEqual([]);
    // A repeat is a no-op.
    await store.removeStarFromAll(7000);
    expect((await getUser(db, 5930))?.stars).toEqual([7001]);
  });

  it("deleteUser removes the doc and is idempotent", async () => {
    await db.collection("users").doc("5940").set({ id: 5940, role: "brother", stars: [] });
    await store.deleteUser(5940);
    expect(await getUser(db, 5940)).toBeNull();
    // Re-running does not throw.
    await store.deleteUser(5940);
    expect(await getUser(db, 5940)).toBeNull();
  });
});
