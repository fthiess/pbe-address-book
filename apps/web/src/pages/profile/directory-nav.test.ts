import { describe, expect, it } from "vitest";
import {
  type DirectoryNavState,
  type DirectoryStash,
  deriveDirectoryNav,
  directoryEntryIsReachable,
  stepNavState,
} from "./directory-nav.js";

const stash: DirectoryStash = { ids: [10, 20, 30], url: "/?q=smy" };
const empty: DirectoryStash = { ids: [], url: "" };
const state: DirectoryNavState = { fromDirectory: true, stashId: "abc", directoryDelta: 1 };

describe("deriveDirectoryNav", () => {
  it("finds prev/next neighbours in the middle of the set", () => {
    const nav = deriveDirectoryNav(state, 20, stash);
    expect(nav.hasStash).toBe(true);
    expect(nav.index).toBe(1);
    expect(nav.total).toBe(3);
    expect(nav.prevId).toBe(10);
    expect(nav.nextId).toBe(30);
    expect(nav.stashId).toBe("abc");
  });

  it("disables Prev at the start of the set", () => {
    const nav = deriveDirectoryNav(state, 10, stash);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBe(20);
    expect(nav.index).toBe(0);
  });

  it("disables Next at the end of the set", () => {
    const nav = deriveDirectoryNav(state, 30, stash);
    expect(nav.prevId).toBe(20);
    expect(nav.nextId).toBeNull();
    expect(nav.index).toBe(2);
  });

  it("keeps prev/next for a stale id that is still a member of the resolved set", () => {
    // The record no longer resolves (deleted/unlisted/etc.), but 20 is still in
    // the id-list, so the user can step past it (no auto-skip, N45).
    const nav = deriveDirectoryNav(state, 20, stash);
    expect(nav.hasStash).toBe(true);
    expect(nav.prevId).toBe(10);
    expect(nav.nextId).toBe(30);
  });

  it("has no stash on a cold deep-link (no state, empty stash)", () => {
    const nav = deriveDirectoryNav(null, 20, empty);
    expect(nav.hasStash).toBe(false);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
    expect(nav.delta).toBe(0);
    expect(nav.total).toBe(0);
    // Nothing to pop and nothing to rebuild — "← Directory" falls back to "/".
    expect(nav.directoryUrl).toBe("");
  });

  it("has no stash when the stash was evicted/missing (id-list empty though delta present)", () => {
    // stashId present in state but the store returned an empty stash (evicted or cleared).
    const nav = deriveDirectoryNav(state, 20, empty);
    expect(nav.hasStash).toBe(false);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
    // delta is still honoured so "← Directory" can pop back correctly.
    expect(nav.delta).toBe(1);
  });

  it("has no stash when the current id is not in the set", () => {
    const nav = deriveDirectoryNav(state, 999, stash);
    expect(nav.hasStash).toBe(false);
    expect(nav.index).toBe(-1);
    expect(nav.prevId).toBeNull();
    expect(nav.nextId).toBeNull();
    expect(nav.delta).toBe(1);
  });

  it("carries the delta through so ← Directory pops to the right entry", () => {
    expect(deriveDirectoryNav({ ...state, directoryDelta: 4 }, 20, stash).delta).toBe(4);
  });

  it("falls back to delta 1 for a legacy fromDirectory entry without a counter", () => {
    expect(deriveDirectoryNav({ fromDirectory: true }, 20, stash).delta).toBe(1);
  });

  it("surfaces the stashed Directory URL as the unreachable-entry fallback (OFC-395)", () => {
    expect(deriveDirectoryNav(state, 20, stash).directoryUrl).toBe("/?q=smy");
  });
});

describe("stepNavState", () => {
  it("re-carries the stash handle at the SAME delta — a step replaces, it does not push", () => {
    // OFC-395: N45 incremented here, one entry per step, until the chain outgrew
    // the browser's bounded session history and "← Directory" silently died.
    const nav = deriveDirectoryNav({ ...state, directoryDelta: 2 }, 20, stash);
    expect(stepNavState(nav)).toEqual({
      fromDirectory: true,
      stashId: "abc",
      directoryDelta: 2,
    });
  });

  it("is idempotent, so a walk of any length stays the same distance from the Directory", () => {
    let nav = deriveDirectoryNav(state, 20, stash);
    for (let step = 0; step < 200; step++) {
      nav = deriveDirectoryNav(stepNavState(nav), 20, stash);
    }
    expect(nav.delta).toBe(1);
  });
});

describe("directoryEntryIsReachable", () => {
  it("accepts a pop that is within the stack", () => {
    expect(directoryEntryIsReachable(1, 2)).toBe(true);
    expect(directoryEntryIsReachable(49, 50)).toBe(true);
  });

  it("rejects a pop past the start of the stack — the pruned-entry case", () => {
    // The UAT failure: 167 steps counted against a stack Chrome had capped at 50.
    expect(directoryEntryIsReachable(167, 50)).toBe(false);
    expect(directoryEntryIsReachable(50, 50)).toBe(false);
  });

  it("rejects delta 0 — a cold deep-link has no Directory entry to return to", () => {
    expect(directoryEntryIsReachable(0, 50)).toBe(false);
  });
});
