import { describe, expect, it } from "vitest";
import type { DirectoryProfile } from "../../lib/types.js";
import { filterRows } from "./query.js";

/** A minimal directory record — only the fields a given assertion exercises. */
function p(partial: Partial<DirectoryProfile> & Pick<DirectoryProfile, "id">): DirectoryProfile {
  return partial;
}

const living = p({ id: 1, firstName: "Al", lastName: "Adams" });
const living2 = p({ id: 2, firstName: "Bo", lastName: "Brown" });
const dead = p({ id: 3, firstName: "Cy", lastName: "Clark", deceased: { isDeceased: true } });
const all = [living, living2, dead];

const ids = (rows: DirectoryProfile[]) => rows.map((r) => r.id);
const base = {
  matchedIds: null,
  includeDeceased: false,
  starredOnly: false,
  stars: new Set<number>(),
};

describe("filterRows — deceased default (D36)", () => {
  it("hides deceased brothers by default", () => {
    expect(ids(filterRows(all, base))).toEqual([1, 2]);
  });

  it("includes the deceased when the toggle is on", () => {
    expect(ids(filterRows(all, { ...base, includeDeceased: true }))).toEqual([1, 2, 3]);
  });
});

describe("filterRows — name-search intersection (D35)", () => {
  it("keeps only the matched ids when a query is active", () => {
    expect(ids(filterRows(all, { ...base, matchedIds: new Set([2]) }))).toEqual([2]);
  });

  it("a null match set means match all", () => {
    expect(ids(filterRows(all, { ...base, matchedIds: null }))).toEqual([1, 2]);
  });
});

describe("filterRows — starred only (D39)", () => {
  it("restricts to the starred set and bypasses the deceased default", () => {
    // Star a living and a deceased brother; both show even with deceased hidden.
    const stars = new Set([1, 3]);
    expect(ids(filterRows(all, { ...base, starredOnly: true, stars }))).toEqual([1, 3]);
  });

  it("AND-composes with the active search", () => {
    const stars = new Set([1, 3]);
    const rows = filterRows(all, {
      ...base,
      starredOnly: true,
      stars,
      matchedIds: new Set([3]),
    });
    expect(ids(rows)).toEqual([3]);
  });

  it("shows the empty set when nothing is starred", () => {
    expect(ids(filterRows(all, { ...base, starredOnly: true, stars: new Set() }))).toEqual([]);
  });
});

describe("filterRows — structured-filter predicate (D38)", () => {
  it("AND-composes the predicate with the deceased default", () => {
    const predicate = (row: DirectoryProfile) => row.lastName === "Adams";
    expect(ids(filterRows(all, { ...base, predicate }))).toEqual([1]);
  });
});
