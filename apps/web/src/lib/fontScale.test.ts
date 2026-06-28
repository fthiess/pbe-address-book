import { afterEach, describe, expect, it, vi } from "vitest";
import { SCALE_PERCENT, getStoredScale, storeScale } from "./fontScale.js";

/** A minimal in-memory localStorage stand-in for the (DOM-less) node test env. */
function installStorage(): Storage {
  const map = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("font scale", () => {
  it("maps each step to its root-percentage anchor (in sync with the no-FOUC script)", () => {
    expect(SCALE_PERCENT).toEqual({ normal: 100, large: 112.5, larger: 125 });
  });

  it("defaults to normal when nothing is stored", () => {
    installStorage();
    expect(getStoredScale()).toBe("normal");
  });

  it("round-trips an explicit step through storage", () => {
    installStorage();
    storeScale("large");
    expect(getStoredScale()).toBe("large");
    storeScale("larger");
    expect(getStoredScale()).toBe("larger");
  });

  it("stores normal as the key's absence (matches the no-FOUC script)", () => {
    const storage = installStorage();
    storage.setItem("book-font-size", "larger");
    storeScale("normal");
    expect(storage.getItem("book-font-size")).toBeNull();
    expect(getStoredScale()).toBe("normal");
  });

  it("ignores an unrecognized stored value", () => {
    const storage = installStorage();
    storage.setItem("book-font-size", "huge");
    expect(getStoredScale()).toBe("normal");
  });
});
