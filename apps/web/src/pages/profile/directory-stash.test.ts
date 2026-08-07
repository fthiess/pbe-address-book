import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearDirectoryStashes,
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

  it("round-trips an id-list and its Directory URL under an explicit stash id", () => {
    const id = newStashId();
    putDirectoryStash(id, [5, 4, 3, 2, 1], "/?q=smy&sort=classYear");
    expect(getDirectoryStash(id)).toEqual({
      ids: [5, 4, 3, 2, 1],
      url: "/?q=smy&sort=classYear",
    });
  });

  it("returns an empty stash for an undefined or unknown stash id", () => {
    expect(getDirectoryStash(undefined)).toEqual({ ids: [], url: "" });
    expect(getDirectoryStash("never-written")).toEqual({ ids: [], url: "" });
  });

  it("still reads a pre-OFC-395 bare array left in storage by an older build", () => {
    // A tab open across a deploy holds entries in the old shape. They must keep
    // driving Prev/Next; only the URL fallback is unavailable for them.
    sessionStorage.setItem("pbe:dirnav:legacy", JSON.stringify([7, 8, 9]));
    expect(getDirectoryStash("legacy")).toEqual({ ids: [7, 8, 9], url: "" });
  });

  it("re-writing the same id overwrites in place — no duplicate accumulates", () => {
    const id = newStashId();
    putDirectoryStash(id, [1, 2], "/");
    putDirectoryStash(id, [1, 2, 3], "/?q=a");
    expect(stashCount()).toBe(1);
    expect(getDirectoryStash(id)).toEqual({ ids: [1, 2, 3], url: "/?q=a" });
  });

  it("bounds retained stashes, evicting the oldest so a long session can't accumulate them", () => {
    const first = newStashId();
    putDirectoryStash(first, [0], "/");
    let last = first;
    for (let i = 1; i <= 40; i++) {
      last = newStashId();
      putDirectoryStash(last, [i], "/");
    }
    expect(getDirectoryStash(first)).toEqual({ ids: [], url: "" }); // evicted
    expect(getDirectoryStash(last)).toEqual({ ids: [40], url: "/" }); // retained
    expect(stashCount()).toBeLessThanOrEqual(12); // MAX_STASHES
  });

  it("clearDirectoryStashes empties the store (all stashes + the index)", () => {
    putDirectoryStash(newStashId(), [1], "/");
    putDirectoryStash(newStashId(), [2], "/");
    expect(stashCount()).toBe(2);
    clearDirectoryStashes();
    expect(stashCount()).toBe(0);
    expect(sessionStorage.getItem("pbe:dirnav:index")).toBeNull();
  });

  it("entryNavState is pure — it carries the handle but writes nothing", () => {
    const id = newStashId();
    const state = entryNavState(id);
    expect(state).toEqual({ fromDirectory: true, stashId: id, directoryDelta: 1 });
    expect(stashCount()).toBe(0); // no write until putDirectoryStash is called on navigation
  });
});
