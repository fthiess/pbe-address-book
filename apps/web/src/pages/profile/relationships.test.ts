import { describe, expect, it } from "vitest";
import type { DirectoryProfile } from "../../lib/types.js";
import {
  bigBrotherEntry,
  littleBrotherEntries,
  littleBrothers,
  rosterNames,
} from "./relationships.js";

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

// The three-state split (D168, OFC-392). Before it, a Big Brother the roster did
// not resolve fell through one `?? "View his profile"` fallback that served both
// "still loading" and "hidden from you" — and that string was then fed to the
// avatar, whose initials come from the *name*, so an unlisted Big Brother rendered
// as a stranger with the invented initials "VP" (View…profile).
describe("bigBrotherEntry", () => {
  const names = rosterNames(roster);

  it("resolves a visible Big Brother to his roster record", () => {
    expect(bigBrotherEntry(roster, names, 5001)).toEqual({
      kind: "known",
      id: 5001,
      name: "Robert Brown '79",
      profile: roster[0],
    });
  });

  it("returns nothing when the record names no Big Brother", () => {
    expect(bigBrotherEntry(roster, names, null)).toBeNull();
    expect(bigBrotherEntry(roster, names, undefined)).toBeNull();
  });

  it("reports a loaded-but-absent Big Brother as private, never as a name", () => {
    // 4242 is not in the roster though the viewed record points at him: the record
    // survives the projection (`bigBrotherId` is public) while its target does not.
    const entry = bigBrotherEntry(roster, names, 4242);
    expect(entry).toEqual({ kind: "private", id: 4242 });
  });

  it("distinguishes a still-loading roster from a private one", () => {
    // The pre-fix bug in miniature: with no roster yet, we do NOT know the brother
    // is private — claiming so would be a lie that resolves itself a second later.
    expect(bigBrotherEntry(null, null, 5001)).toEqual({ kind: "pending", id: 5001 });
    expect(bigBrotherEntry(roster, null, 5001)).toEqual({ kind: "pending", id: 5001 });
  });
});

describe("littleBrotherEntries", () => {
  const names = rosterNames(roster);

  it("lists the visible little brothers, then one placeholder per hidden one", () => {
    expect(littleBrotherEntries(roster, names, 5001, 2)).toEqual([
      { kind: "known", id: 5248, name: "Alan Avery '86", profile: roster[2] },
      { kind: "known", id: 5247, name: "James Smyth '84", profile: roster[1] },
      { kind: "private", id: null },
      { kind: "private", id: null },
    ]);
  });

  it("yields placeholders even when every little brother is hidden", () => {
    // The reported bug: with no visible littles and no Big Brother, the whole
    // Relationships section vanished — an *unlisted* little brother rendered
    // identically to *no* little brother.
    expect(littleBrotherEntries(roster, names, 5249, 1)).toEqual([{ kind: "private", id: null }]);
  });

  it("is empty when there are neither visible nor hidden little brothers", () => {
    expect(littleBrotherEntries(roster, names, 5249, 0)).toEqual([]);
  });

  it("treats an absent count as none hidden", () => {
    expect(
      littleBrotherEntries(roster, names, 5001, undefined).every((e) => e.kind === "known"),
    ).toBe(true);
  });

  it("returns nothing while the roster is still loading", () => {
    // Placeholders would be honest here, but the visible littles are not known yet,
    // so rendering only the private ones would order them wrongly and then reflow.
    expect(littleBrotherEntries(null, null, 5001, 2)).toEqual([]);
  });
});
