import { describe, expect, it } from "vitest";
import {
  type DirectoryNavState,
  deriveDirectoryNav,
  entryNavState,
  stepNavState,
} from "./directory-nav.js";

const set: DirectoryNavState = {
  fromDirectory: true,
  directoryIds: [10, 20, 30],
  directoryDelta: 1,
};

describe("deriveDirectoryNav", () => {
  it("finds prev/next neighbours in the middle of the set", () => {
    const nav = deriveDirectoryNav(set, 20);
    expect(nav.hasStash).toBe(true);
    expect(nav.index).toBe(1);
    expect(nav.total).toBe(3);
    expect(nav.prevId).toBe(10);
    expect(nav.nextId).toBe(30);
  });

  it("disables Prev at the start of the set", () => {
    const nav = deriveDirectoryNav(set, 10);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBe(20);
    expect(nav.index).toBe(0);
  });

  it("disables Next at the end of the set", () => {
    const nav = deriveDirectoryNav(set, 30);
    expect(nav.prevId).toBe(20);
    expect(nav.nextId).toBeNull();
    expect(nav.index).toBe(2);
  });

  it("keeps prev/next for a stale id that is still a member of the stashed set", () => {
    // The record no longer resolves (deleted/unlisted/etc.), but 20 is still in
    // the id-list, so the user can step past it (no auto-skip, N45).
    const nav = deriveDirectoryNav(set, 20);
    expect(nav.hasStash).toBe(true);
    expect(nav.prevId).toBe(10);
    expect(nav.nextId).toBe(30);
  });

  it("has no stash on a cold deep-link (no state)", () => {
    const nav = deriveDirectoryNav(null, 20);
    expect(nav.hasStash).toBe(false);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
    expect(nav.delta).toBe(0);
    expect(nav.total).toBe(0);
  });

  it("has no stash when the current id is not in the set", () => {
    const nav = deriveDirectoryNav(set, 999);
    expect(nav.hasStash).toBe(false);
    expect(nav.index).toBe(-1);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
    // delta is still honoured so "← Directory" can pop back correctly.
    expect(nav.delta).toBe(1);
  });

  it("carries the delta through so ← Directory pops to the right entry", () => {
    expect(deriveDirectoryNav({ ...set, directoryDelta: 4 }, 20).delta).toBe(4);
  });

  it("falls back to delta 1 for a legacy fromDirectory entry without a counter", () => {
    expect(deriveDirectoryNav({ fromDirectory: true }, 20).delta).toBe(1);
  });
});

describe("entryNavState", () => {
  it("stashes the id-list at delta 1", () => {
    expect(entryNavState([1, 2, 3])).toEqual({
      fromDirectory: true,
      directoryIds: [1, 2, 3],
      directoryDelta: 1,
    });
  });
});

describe("stepNavState", () => {
  it("re-carries the id-list and increments the delta on each Prev/Next push", () => {
    const nav = deriveDirectoryNav({ ...set, directoryDelta: 2 }, 20);
    expect(stepNavState(nav)).toEqual({
      fromDirectory: true,
      directoryIds: [10, 20, 30],
      directoryDelta: 3,
    });
  });
});
