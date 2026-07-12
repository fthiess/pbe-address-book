import { describe, expect, it } from "vitest";
import { added, removed, toggled } from "./SelectionContext.js";

const setOf = (...ids: number[]) => new Set(ids);
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe("selection algebra (N79/OFC-196)", () => {
  describe("toggled", () => {
    it("adds an absent id and removes a present one, without mutating the input", () => {
      const base = setOf(1, 2);
      const withThree = toggled(base, 3);
      expect(sorted(withThree)).toEqual([1, 2, 3]);
      expect(sorted(base)).toEqual([1, 2]); // input untouched

      const withoutTwo = toggled(base, 2);
      expect(sorted(withoutTwo)).toEqual([1]);
      expect(sorted(base)).toEqual([1, 2]);
    });
  });

  describe("added (header select-all over the visible view)", () => {
    it("unions the given ids while preserving off-view selections", () => {
      const result = added(setOf(1, 2), [2, 3, 4]);
      expect(sorted(result)).toEqual([1, 2, 3, 4]);
    });

    it("returns the same reference when every id is already selected (no-op)", () => {
      const base = setOf(1, 2, 3);
      expect(added(base, [1, 2])).toBe(base);
    });
  });

  describe("removed (header deselect over the visible view)", () => {
    it("removes only the given ids and leaves off-view selections standing", () => {
      // The core OFC-196 guarantee: deselecting the visible '80s must not drop the '70s.
      const result = removed(setOf(1, 2, 3, 4), [3, 4]);
      expect(sorted(result)).toEqual([1, 2]);
    });

    it("returns the same reference when none of the ids are selected (no-op)", () => {
      const base = setOf(1, 2);
      expect(removed(base, [7, 8])).toBe(base);
    });
  });

  it("supports the disjoint-set workflow across filters", () => {
    // Filter to '70 → select all; filter to '80 → select all; both survive.
    let sel = setOf();
    sel = added(sel, [10, 11]); // class of 1970, currently visible
    sel = added(sel, [20, 21]); // class of 1980, a different view
    expect(sorted(sel)).toEqual([10, 11, 20, 21]);
    // Deselecting one view's rows leaves the other's intact.
    sel = removed(sel, [20, 21]);
    expect(sorted(sel)).toEqual([10, 11]);
  });
});
