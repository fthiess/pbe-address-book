import { describe, expect, it } from "vitest";
import { joinedName, planFullNameBackfill } from "./full-name-backfill.js";

describe("joinedName", () => {
  it("joins first, middle and last, skipping an absent or blank middle", () => {
    expect(joinedName({ firstName: "James", middleName: "Alan", lastName: "Smyth" })).toBe(
      "James Alan Smyth",
    );
    expect(joinedName({ firstName: "James", lastName: "Smyth" })).toBe("James Smyth");
    expect(joinedName({ firstName: " James ", middleName: "  ", lastName: "Smyth" })).toBe(
      "James Smyth",
    );
  });
});

describe("planFullNameBackfill", () => {
  it("fills only records whose fullLegalName is absent or blank", () => {
    const plan = planFullNameBackfill([
      { id: "5247", data: { firstName: "James", middleName: "Alan", lastName: "Smyth" } },
      { id: "5248", data: { firstName: "Jim", lastName: "Smyth", fullLegalName: "" } },
      { id: "5249", data: { firstName: "Jon", lastName: "Smyth", fullLegalName: "   " } },
      // A hand-edited value, and a genesis suffix — both untouched, whatever they say.
      {
        id: "5250",
        data: { firstName: "Al", lastName: "Smyth", fullLegalName: "Alfred Smyth III" },
      },
      { id: "5251", data: { firstName: "Bo", lastName: "Smyth", fullLegalName: "Bo Smyth" } },
    ]);
    expect(plan.updates).toEqual([
      { docId: "5247", fullLegalName: "James Alan Smyth" },
      { docId: "5248", fullLegalName: "Jim Smyth" },
      { docId: "5249", fullLegalName: "Jon Smyth" },
    ]);
    expect(plan.alreadySet).toBe(2);
    expect(plan.unnamed).toEqual([]);
  });

  it("skips a record with no usable first or last name rather than writing a fragment", () => {
    const plan = planFullNameBackfill([
      { id: "1", data: { firstName: "", lastName: "Smyth" } },
      { id: "2", data: { firstName: "James", lastName: undefined } },
      { id: "3", data: { firstName: 42, lastName: "Smyth" } },
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.unnamed).toEqual(["1", "2", "3"]);
  });

  it("is a no-op on an empty collection", () => {
    expect(planFullNameBackfill([])).toEqual({ updates: [], alreadySet: 0, unnamed: [] });
  });
});
