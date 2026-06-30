import { describe, expect, it } from "vitest";
import type { DirectoryProfile } from "../../lib/types.js";
import { littleBrothers, rosterNames } from "./relationships.js";

const roster: DirectoryProfile[] = [
  { id: 5001, firstName: "Robert", lastName: "Brown", classYear: 1979 },
  { id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984, bigBrotherId: 5001 },
  { id: 5248, firstName: "Alan", lastName: "Avery", classYear: 1986, bigBrotherId: 5001 },
  { id: 5249, firstName: "Tom", lastName: "Wills", classYear: 1990, bigBrotherId: 5247 },
];

describe("rosterNames", () => {
  it("renders the Canonical Name of every roster member", () => {
    const names = rosterNames(roster);
    expect(names.get(5247)).toBe("James Smyth '84");
    expect(names.get(5001)).toBe("Robert Brown '79");
  });
});

describe("littleBrothers", () => {
  it("derives the brothers who name the given id as Big Brother, name-sorted", () => {
    const names = rosterNames(roster);
    const littles = littleBrothers(roster, names, 5001);
    expect(littles.map((l) => l.id)).toEqual([5248, 5247]); // Avery before Smyth
    expect(littles.map((l) => l.name)).toEqual(["Alan Avery '86", "James Smyth '84"]);
  });

  it("returns an empty list when no one names the id", () => {
    const names = rosterNames(roster);
    expect(littleBrothers(roster, names, 5249)).toEqual([]);
  });

  it("follows a one-step chain (a little brother can have his own littles)", () => {
    const names = rosterNames(roster);
    expect(littleBrothers(roster, names, 5247).map((l) => l.id)).toEqual([5249]);
  });
});
