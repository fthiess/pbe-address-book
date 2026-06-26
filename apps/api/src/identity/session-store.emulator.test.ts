import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";
import type { Session } from "./types.js";

const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

function makeSession(profileId: number, expiresAt: number): Session {
  return {
    identity: {
      subject: String(profileId),
      profileId,
      email: `b${profileId}@example.test`,
      role: "brother",
      displayName: "B",
    },
    expiresAt,
  };
}

describe.skipIf(!hasEmulator)("SessionStore (emulator)", () => {
  let db: Firestore;

  beforeAll(() => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();
  });

  it("persists a session and reads it back from Firestore on a cold start", async () => {
    const writer = new SessionStore(db);
    const id = await writer.create(makeSession(5001, Date.now() + 60_000));

    // A *fresh* store has an empty in-memory cache — this read must hit Firestore,
    // which is exactly the scale-to-zero cold-start path D125 protects.
    const coldReader = new SessionStore(db);
    const session = await coldReader.get(id);
    expect(session?.identity.profileId).toBe(5001);
  });

  it("treats a lapsed session as absent and cleans it up", async () => {
    const store = new SessionStore(db);
    const id = await store.create(makeSession(5002, Date.now() - 1000));

    // Cold read (no cache hit) of an already-expired record returns null.
    const session = await new SessionStore(db).get(id);
    expect(session).toBeNull();
    const doc = await db.collection("sessions").doc(id).get();
    expect(doc.exists).toBe(false);
  });

  it("destroy invalidates the session everywhere", async () => {
    const store = new SessionStore(db);
    const id = await store.create(makeSession(5003, Date.now() + 60_000));
    await store.destroy(id);
    expect(await store.get(id)).toBeNull();
    expect(await new SessionStore(db).get(id)).toBeNull();
  });
});
