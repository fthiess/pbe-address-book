import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeProfile } from "../test-support/make-profile.js";
import {
  FirestoreProfileStore,
  MissingProfileError,
  ProfileExistsError,
  StaleWriteError,
  encodeToken,
} from "./profiles.js";

// This suite only runs under the Firestore emulator (set by emulators:exec). The
// `412` precondition is the one thing a fake store cannot honestly prove — it is
// Firestore's native `lastUpdateTime` precondition, exercised for real here.
const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!hasEmulator)("FirestoreProfileStore (emulator) — optimistic concurrency", () => {
  let db: Firestore;
  let store: FirestoreProfileStore;

  beforeAll(() => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();
    store = new FirestoreProfileStore(db);
  });

  beforeEach(async () => {
    await db
      .collection("profiles")
      .doc("5247")
      .set(makeProfile({ id: 5247 }));
  });

  afterAll(async () => {
    await db.collection("profiles").doc("5247").delete();
  });

  /** Read the current concurrency token straight off the stored document. */
  async function currentToken(): Promise<string> {
    const snap = await db.collection("profiles").doc("5247").get();
    if (!snap.updateTime) {
      throw new Error("expected an updateTime on the stored document");
    }
    return encodeToken(snap.updateTime);
  }

  it("applies a write that carries the current token and returns a fresh token", async () => {
    const token = await currentToken();
    const next = await store.update(5247, {
      set: { phone: "+1-617-555-0100" },
      remove: [],
      precondition: token,
    });

    expect(next).not.toBe(token);
    const snap = await db.collection("profiles").doc("5247").get();
    expect(snap.data()?.phone).toBe("+1-617-555-0100");
    expect(next).toBe(encodeToken(snap.updateTime as FirebaseFirestore.Timestamp));
  });

  it("rejects a write carrying a stale token with a StaleWriteError (→ 412)", async () => {
    const stale = await currentToken();
    // A concurrent write moves the record on, invalidating `stale`.
    await store.update(5247, { set: { jobTitle: "Engineer" }, remove: [], precondition: stale });

    await expect(
      store.update(5247, { set: { jobTitle: "Manager" }, remove: [], precondition: stale }),
    ).rejects.toBeInstanceOf(StaleWriteError);
  });

  it("removes a field via the delete sentinel (the D28 verification clear)", async () => {
    // Seed a verified record, then clear verification through `remove`.
    await db
      .collection("profiles")
      .doc("5247")
      .set(makeProfile({ id: 5247, lastVerifiedDate: "2026-01-01", verifiedBy: 5001 }));
    const token = await currentToken();

    await store.update(5247, {
      set: { phone: "+1-617-555-0199" },
      remove: ["lastVerifiedDate", "verifiedBy"],
      precondition: token,
    });

    const snap = await db.collection("profiles").doc("5247").get();
    expect(snap.data()?.lastVerifiedDate).toBeUndefined();
    expect(snap.data()?.verifiedBy).toBeUndefined();
    expect(snap.data()?.phone).toBe("+1-617-555-0199");
  });

  it("rejects a malformed concurrency token as a StaleWriteError (→ 412), not a 500 (OFC-90)", async () => {
    // A token that is not `<sec>.<nanos>` would build `Timestamp(NaN)` and throw a
    // code-less error the catch cannot map — surfacing as 500. It must instead be
    // treated as a failed precondition.
    await expect(
      store.update(5247, { set: { phone: "555" }, remove: [], precondition: "not-a-token" }),
    ).rejects.toBeInstanceOf(StaleWriteError);
  });

  it("applies an unconditional write (the headshot pointer, N42) and returns a fresh token", async () => {
    const before = await currentToken();
    const token = await store.updateUnconditional(5247, {
      set: { hasHeadshot: true, headshotVersion: "abc123" },
      remove: [],
    });

    expect(token).not.toBe(before);
    const snap = await db.collection("profiles").doc("5247").get();
    expect(snap.data()?.hasHeadshot).toBe(true);
    expect(snap.data()?.headshotVersion).toBe("abc123");
    expect(token).toBe(encodeToken(snap.updateTime as FirebaseFirestore.Timestamp));
  });

  it("removes a field on an unconditional write (the headshot DELETE pointer)", async () => {
    await db
      .collection("profiles")
      .doc("5247")
      .set(makeProfile({ id: 5247, hasHeadshot: true, headshotVersion: "abc123" }));

    await store.updateUnconditional(5247, {
      set: { hasHeadshot: false },
      remove: ["headshotVersion"],
    });

    const snap = await db.collection("profiles").doc("5247").get();
    expect(snap.data()?.hasHeadshot).toBe(false);
    expect(snap.data()?.headshotVersion).toBeUndefined();
  });

  it("throws MissingProfileError on an unconditional write to a deleted document", async () => {
    await db.collection("profiles").doc("5247").delete();
    await expect(
      store.updateUnconditional(5247, { set: { hasHeadshot: true }, remove: [] }),
    ).rejects.toBeInstanceOf(MissingProfileError);
  });

  it("fails the precondition (StaleWriteError) when the document has been deleted", async () => {
    // A delete moves the record out from under a held token. Firestore reports an
    // `updateTime` precondition against a now-missing document as a precondition
    // failure, so the write surfaces as a stale write (→ 412) — the client then
    // repulls via the read path and gets a 404, the same reconcile route as any
    // other conflict.
    const token = await currentToken();
    await db.collection("profiles").doc("5247").delete();

    await expect(
      store.update(5247, { set: { phone: "555-0100" }, remove: [], precondition: token }),
    ).rejects.toBeInstanceOf(StaleWriteError);
  });

  it("create() writes a new document and returns its initial token (OFC-201)", async () => {
    await db.collection("profiles").doc("6001").delete(); // ensure absent
    const token = await store.create(6001, makeProfile({ id: 6001, firstName: "New" }));
    const snap = await db.collection("profiles").doc("6001").get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.firstName).toBe("New");
    expect(token).toBe(encodeToken(snap.updateTime as FirebaseFirestore.Timestamp));
    await db.collection("profiles").doc("6001").delete();
  });

  it("create() rejects a duplicate id atomically as a ProfileExistsError (→ 409)", async () => {
    // 5247 is seeded in beforeEach, so a create must fail ALREADY_EXISTS rather
    // than overwrite the live record — the native atomic guard behind the 409.
    await expect(store.create(5247, makeProfile({ id: 5247 }))).rejects.toBeInstanceOf(
      ProfileExistsError,
    );
    // The original record is untouched.
    const snap = await db.collection("profiles").doc("5247").get();
    expect(snap.data()?.firstName).toBe("James");
  });

  it("delete() removes the document and is idempotent (the admin delete, N41)", async () => {
    await store.delete(5247);
    expect((await db.collection("profiles").doc("5247").get()).exists).toBe(false);
    // A re-run does not throw — the re-runnable delete D98 relies on.
    await store.delete(5247);
    expect((await db.collection("profiles").doc("5247").get()).exists).toBe(false);
  });
});
