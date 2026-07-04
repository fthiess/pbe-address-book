import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entryNavState, getDirectoryStash, putDirectoryStash } from "./directory-stash.js";

// The SPA unit tests run under the `node` environment (DOM-free by design — see
// vitest.config.ts), so provide a faithful in-memory `sessionStorage` stub rather
// than pull in jsdom. This exercises the store's real put/get/evict/index logic.
beforeEach(() => {
  const map = new Map<string, string>();
  const stub: Storage = {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  (globalThis as { sessionStorage?: Storage }).sessionStorage = stub;
});

afterEach(() => {
  (globalThis as { sessionStorage?: Storage }).sessionStorage = undefined;
});

describe("directory stash store (OFC-141)", () => {
  it("round-trips an id-list through a stash id", () => {
    const stashId = putDirectoryStash([5, 4, 3, 2, 1]);
    expect(stashId).toBeTruthy();
    expect(getDirectoryStash(stashId)).toEqual([5, 4, 3, 2, 1]);
  });

  it("returns [] for an undefined or unknown stash id", () => {
    expect(getDirectoryStash(undefined)).toEqual([]);
    expect(getDirectoryStash("never-written")).toEqual([]);
  });

  it("mints a distinct id per stash so concurrent Directory views don't collide", () => {
    const a = putDirectoryStash([1, 2]);
    const b = putDirectoryStash([3, 4]);
    expect(a).not.toBe(b);
    expect(getDirectoryStash(a)).toEqual([1, 2]);
    expect(getDirectoryStash(b)).toEqual([3, 4]);
  });

  it("bounds retained stashes, evicting the oldest so a long session can't accumulate them", () => {
    // Write well past the cap; the earliest writes must have been evicted while
    // the most recent survive.
    const first = putDirectoryStash([0]);
    const rest = Array.from({ length: 40 }, (_, i) => putDirectoryStash([i + 1]));
    expect(getDirectoryStash(first)).toEqual([]); // evicted
    const last = rest[rest.length - 1];
    expect(getDirectoryStash(last)).toEqual([40]); // retained
  });

  it("entryNavState stashes once and carries only the handle at delta 1", () => {
    const state = entryNavState([7, 8, 9]);
    expect(state.fromDirectory).toBe(true);
    expect(state.directoryDelta).toBe(1);
    expect(state).not.toHaveProperty("directoryIds");
    expect(getDirectoryStash(state.stashId)).toEqual([7, 8, 9]);
  });
});
