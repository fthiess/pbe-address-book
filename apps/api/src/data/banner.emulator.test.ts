import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FirestoreBackupSource } from "./backup.js";
import { FirestoreBannerStore, type StoredBanner } from "./banner.js";

const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!hasEmulator)("system banner + backup (emulator)", () => {
  let db: Firestore;

  beforeAll(() => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();
  });

  // The emulator suites share one Firestore (vitest.emulator.config.ts,
  // fileParallelism:false) and cache.emulator.test.ts asserts a *whole*-collection
  // count of `profiles`, so this suite must leave the shared collections exactly as
  // it found them — delete every doc it wrote.
  afterAll(async () => {
    await Promise.all([
      db.collection("profiles").doc("5800").delete(),
      db.collection("users").doc("5800").delete(),
      db.collection("config").doc("systemBanner").delete(),
    ]);
  });

  it("FirestoreBannerStore.get returns null before any banner is set", async () => {
    // A distinct DB from the other suites' collections; the config doc is fresh.
    const store = new FirestoreBannerStore(db);
    expect(await store.get()).toBeNull();
  });

  it("round-trips a banner through the config/systemBanner singleton", async () => {
    const store = new FirestoreBannerStore(db);
    const banner: StoredBanner = {
      active: true,
      message: "Scheduled maintenance Sunday 2–4am ET.",
      severity: "warning",
      updatedBy: 5001,
      updatedAt: "2026-07-05T12:00:00.000Z",
    };
    await store.set(banner);
    expect(await store.get()).toEqual(banner);

    // The stored doc lives at the fixed singleton id (DATABASE-SCHEMA §6.3).
    const raw = await db.collection("config").doc("systemBanner").get();
    expect(raw.exists).toBe(true);
    expect(raw.data()).toEqual(banner);
  });

  it("set() replaces (not merges) so a clear leaves no lingering message", async () => {
    const store = new FirestoreBannerStore(db);
    await store.set({
      active: true,
      message: "temporary",
      severity: "info",
      updatedBy: 5001,
      updatedAt: "2026-07-05T12:00:00.000Z",
    });
    const cleared: StoredBanner = {
      active: false,
      message: "",
      severity: "info",
      updatedBy: 5002,
      updatedAt: "2026-07-05T13:00:00.000Z",
    };
    await store.set(cleared);
    expect(await store.get()).toEqual(cleared);
  });

  it("FirestoreBackupSource reads the live profiles/users/config collections", async () => {
    await db.collection("profiles").doc("5800").set({ id: 5800, lastName: "Backup" });
    await db.collection("users").doc("5800").set({ id: 5800, role: "brother", stars: [] });

    const data = await new FirestoreBackupSource(db).export();
    expect(data.profiles.some((d) => d.id === "5800")).toBe(true);
    expect(data.users.some((d) => d.id === "5800")).toBe(true);
    // config carries the banner singleton written above.
    expect(data.config.some((d) => d.id === "systemBanner")).toBe(true);
    // Each snapshot preserves the doc id alongside the data (restore fidelity).
    const profile = data.profiles.find((d) => d.id === "5800");
    expect(profile?.data).toMatchObject({ id: 5800, lastName: "Backup" });
  });
});
