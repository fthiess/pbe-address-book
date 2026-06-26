import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { NonceStore } from "./nonce-store.js";

const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!hasEmulator)("NonceStore (emulator)", () => {
  let db: Firestore;

  beforeAll(() => {
    if (getApps().length === 0) {
      initializeApp({ projectId: "demo-pbe-book" });
    }
    db = getFirestore();
  });

  it("consumes a valid nonce exactly once (replay fails closed)", async () => {
    const store = new NonceStore(db);
    const nonce = await store.issue();
    expect(await store.consume(nonce)).toBe(true);
    // A second consume — a replay — must fail.
    expect(await store.consume(nonce)).toBe(false);
  });

  it("rejects an unknown nonce", async () => {
    const store = new NonceStore(db);
    expect(await store.consume("never-issued")).toBe(false);
  });

  it("rejects an expired nonce (and still consumes it)", async () => {
    const store = new NonceStore(db, 1000); // 1-second TTL
    const issuedAt = Date.now();
    const nonce = await store.issue(issuedAt);
    // Consume well past the TTL window.
    expect(await store.consume(nonce, issuedAt + 5000)).toBe(false);
    // It was deleted regardless, so even an in-window replay now fails.
    expect(await store.consume(nonce, issuedAt + 100)).toBe(false);
  });
});
