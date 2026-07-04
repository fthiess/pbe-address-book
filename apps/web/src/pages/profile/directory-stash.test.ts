import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  entryNavState,
  getDirectoryStash,
  newStashId,
  putDirectoryStash,
} from "./directory-stash.js";

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

/** Count of stored id-lists (the index key aside). */
function stashCount(): number {
  let n = 0;
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k?.startsWith("pbe:dirnav:") && k !== "pbe:dirnav:index") {
      n += 1;
    }
  }
  return n;
}

describe("directory stash store (OFC-141 + lazy-write follow-up)", () => {
  it("mints distinct ids and writes nothing on its own", () => {
    const a = newStashId();
    const b = newStashId();
    expect(a).not.toBe(b);
    expect(stashCount()).toBe(0); // newStashId does not touch storage
  });

  it("round-trips an id-list written under an explicit stash id", () => {
    const id = newStashId();
    putDirectoryStash(id, [5, 4, 3, 2, 1]);
    expect(getDirectoryStash(id)).toEqual([5, 4, 3, 2, 1]);
  });

  it("returns [] for an undefined or unknown stash id", () => {
    expect(getDirectoryStash(undefined)).toEqual([]);
    expect(getDirectoryStash("never-written")).toEqual([]);
  });

  it("re-writing the same id overwrites in place — no duplicate accumulates", () => {
    const id = newStashId();
    putDirectoryStash(id, [1, 2]);
    putDirectoryStash(id, [1, 2, 3]);
    expect(stashCount()).toBe(1);
    expect(getDirectoryStash(id)).toEqual([1, 2, 3]);
  });

  it("bounds retained stashes, evicting the oldest so a long session can't accumulate them", () => {
    const first = newStashId();
    putDirectoryStash(first, [0]);
    let last = first;
    for (let i = 1; i <= 40; i++) {
      last = newStashId();
      putDirectoryStash(last, [i]);
    }
    expect(getDirectoryStash(first)).toEqual([]); // evicted
    expect(getDirectoryStash(last)).toEqual([40]); // retained
    expect(stashCount()).toBeLessThanOrEqual(12); // MAX_STASHES
  });

  it("entryNavState is pure — it carries the handle but writes nothing", () => {
    const id = newStashId();
    const state = entryNavState(id);
    expect(state).toEqual({ fromDirectory: true, stashId: id, directoryDelta: 1 });
    expect(stashCount()).toBe(0); // no write until putDirectoryStash is called on navigation
  });
});
