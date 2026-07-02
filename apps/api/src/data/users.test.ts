import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { addStar, removeStar } from "./users.js";

/**
 * Pure unit tests for the `mutateStars` error handling (OFC-98) — no emulator.
 * The happy path and the genuinely-absent path are also covered end-to-end in
 * `users.emulator.test.ts`; here we inject `update()` failures a real emulator
 * can't produce on demand to prove the create-if-absent fallback is scoped to
 * `NOT_FOUND` and never clobbers an existing doc on a transient error.
 */

type Doc = { id: number; role: string; stars: number[] } | undefined;

/** A minimal fake Firestore whose single `users` ref behaves as configured. */
function fakeDb(opts: { updateError?: unknown; doc?: Doc }) {
  let current: Doc = opts.doc;
  const update = vi.fn(async () => {
    if (opts.updateError !== undefined) {
      throw opts.updateError;
    }
  });
  const set = vi.fn(async (record: Doc) => {
    current = record;
  });
  const get = vi.fn(async () => ({ data: () => current }));
  const ref = { update, set, get };
  const db = { collection: () => ({ doc: () => ref }) } as unknown as Firestore;
  return { db, update, set, get };
}

describe("mutateStars error handling (OFC-98)", () => {
  it("re-throws a transient update() failure and never overwrites an existing doc", async () => {
    // An admin's doc already exists; update() fails for a transient reason
    // (14 = UNAVAILABLE). The fallback set() must NOT fire — that would reset the
    // admin to role "brother" and wipe their stars.
    const { db, set } = fakeDb({
      updateError: { code: 14 },
      doc: { id: 5902, role: "admin", stars: [5001, 5002] },
    });
    await expect(addStar(db, 5902, 5305)).rejects.toEqual({ code: 14 });
    expect(set).not.toHaveBeenCalled();
  });

  it("creates a minimal brother record only when the doc is genuinely absent (NOT_FOUND)", async () => {
    // 5 = NOT_FOUND: update() on an absent doc. The fallback creates a fresh
    // brother record carrying just the toggled star.
    const { db, set } = fakeDb({ updateError: { code: 5 } });
    expect(await addStar(db, 5904, 5012)).toEqual([5012]);
    expect(set).toHaveBeenCalledWith({ id: 5904, role: "brother", stars: [5012] });
  });

  it("creates an empty-star brother record when removing against an absent doc", async () => {
    const { db, set } = fakeDb({ updateError: { code: 5 } });
    expect(await removeStar(db, 5905, 5012)).toEqual([]);
    expect(set).toHaveBeenCalledWith({ id: 5905, role: "brother", stars: [] });
  });

  it("takes no fallback set() on the normal (update succeeds) path", async () => {
    const { db, set, update } = fakeDb({ doc: { id: 5903, role: "manager", stars: [5012] } });
    await addStar(db, 5903, 5305);
    expect(update).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
  });
});
