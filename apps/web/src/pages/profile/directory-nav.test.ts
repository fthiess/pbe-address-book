import { describe, expect, it } from "vitest";
import { type DirectoryNavState, deriveDirectoryNav, stepNavState } from "./directory-nav.js";

const ids = [10, 20, 30];
const state: DirectoryNavState = { fromDirectory: true, stashId: "abc", directoryDelta: 1 };

describe("deriveDirectoryNav", () => {
  it("finds prev/next neighbours in the middle of the set", () => {
    const nav = deriveDirectoryNav(state, 20, ids);
    expect(nav.hasStash).toBe(true);
    expect(nav.index).toBe(1);
    expect(nav.total).toBe(3);
    expect(nav.prevId).toBe(10);
    expect(nav.nextId).toBe(30);
    expect(nav.stashId).toBe("abc");
  });

  it("disables Prev at the start of the set", () => {
    const nav = deriveDirectoryNav(state, 10, ids);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBe(20);
    expect(nav.index).toBe(0);
  });

  it("disables Next at the end of the set", () => {
    const nav = deriveDirectoryNav(state, 30, ids);
    expect(nav.prevId).toBe(20);
    expect(nav.nextId).toBeNull();
    expect(nav.index).toBe(2);
  });

  it("keeps prev/next for a stale id that is still a member of the resolved set", () => {
    // The record no longer resolves (deleted/unlisted/etc.), but 20 is still in
    // the id-list, so the user can step past it (no auto-skip, N45).
    const nav = deriveDirectoryNav(state, 20, ids);
    expect(nav.hasStash).toBe(true);
    expect(nav.prevId).toBe(10);
    expect(nav.nextId).toBe(30);
  });

  it("has no stash on a cold deep-link (no state, empty id-list)", () => {
    const nav = deriveDirectoryNav(null, 20, []);
    expect(nav.hasStash).toBe(false);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
    expect(nav.delta).toBe(0);
    expect(nav.total).toBe(0);
  });

  it("has no stash when the stash was evicted/missing (id-list empty though delta present)", () => {
    // stashId present in state but the store returned [] (evicted or cleared).
    const nav = deriveDirectoryNav(state, 20, []);
    expect(nav.hasStash).toBe(false);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
    // delta is still honoured so "← Directory" can pop back correctly.
    expect(nav.delta).toBe(1);
  });

  it("has no stash when the current id is not in the set", () => {
    const nav = deriveDirectoryNav(state, 999, ids);
    expect(nav.hasStash).toBe(false);
    expect(nav.index).toBe(-1);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
    expect(nav.delta).toBe(1);
  });

  it("carries the delta through so ← Directory pops to the right entry", () => {
    expect(deriveDirectoryNav({ ...state, directoryDelta: 4 }, 20, ids).delta).toBe(4);
  });

  it("falls back to delta 1 for a legacy fromDirectory entry without a counter", () => {
    expect(deriveDirectoryNav({ fromDirectory: true }, 20, ids).delta).toBe(1);
  });
});

describe("stepNavState", () => {
  it("re-carries the stash handle and increments the delta on each Prev/Next push", () => {
    const nav = deriveDirectoryNav({ ...state, directoryDelta: 2 }, 20, ids);
    expect(stepNavState(nav)).toEqual({
      fromDirectory: true,
      stashId: "abc",
      directoryDelta: 3,
    });
  });
});
