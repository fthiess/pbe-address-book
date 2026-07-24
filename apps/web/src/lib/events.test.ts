import { describe, expect, it } from "vitest";
import {
  type EventProperties,
  FILTER_DIMENSIONS,
  activeFilterKeys,
  fieldGroupsChanged,
  resultBucket,
  rowCountBucket,
} from "./events.js";

describe("resultBucket (P6)", () => {
  it.each([
    [-1, "0"],
    [0, "0"],
    [1, "1"],
    [2, "2-10"],
    [10, "2-10"],
    [11, "11+"],
    [700, "11+"],
  ])("buckets %i as %s", (count, expected) => {
    expect(resultBucket(count)).toBe(expected);
  });
});

describe("rowCountBucket (P6, export)", () => {
  it.each([
    [1, "1"],
    [2, "2-10"],
    [10, "2-10"],
    [11, "11-100"],
    [100, "11-100"],
    [101, "101+"],
    [700, "101+"],
  ])("buckets %i as %s", (count, expected) => {
    expect(rowCountBucket(count)).toBe(expected);
  });

  it("never returns a raw count — only one of the four tiers", () => {
    for (let n = 1; n <= 800; n++) {
      expect(["1", "2-10", "11-100", "101+"]).toContain(rowCountBucket(n));
    }
  });
});

describe("fieldGroupsChanged (P6 — labels, never values)", () => {
  it("maps each writable Profile key to its coarse group", () => {
    expect(fieldGroupsChanged(["email"], false)).toEqual(["contact"]);
    expect(fieldGroupsChanged(["employerName"], false)).toEqual(["professional"]);
    expect(fieldGroupsChanged(["bigBrotherId"], false)).toEqual(["relationships"]);
    expect(fieldGroupsChanged(["firstName"], false)).toEqual(["identity"]);
    // `privacy` is one key covering the whole PrivacyFlags block.
    expect(fieldGroupsChanged(["privacy"], false)).toEqual(["privacy"]);
    expect(fieldGroupsChanged(["allowNewsletterEmail"], false)).toEqual(["privacy"]);
  });

  it("adds `photo` when the headshot changed, independent of the patch", () => {
    expect(fieldGroupsChanged([], true)).toEqual(["photo"]);
    expect(fieldGroupsChanged(["email"], true)).toEqual(["contact", "photo"]);
  });

  it("de-duplicates and returns groups in canonical order", () => {
    // email+phone are both `contact`; classYear is `identity`; ordering is fixed
    // regardless of the input order.
    expect(fieldGroupsChanged(["phone", "classYear", "email"], false)).toEqual([
      "identity",
      "contact",
    ]);
  });

  it("routes an unmapped or staff-only key to `other`, never dropping it", () => {
    expect(fieldGroupsChanged(["adminNote"], false)).toEqual(["other"]);
    expect(fieldGroupsChanged(["someFutureField"], false)).toEqual(["other"]);
  });

  it("returns nothing but group labels — no field names or values leak", () => {
    const groups = fieldGroupsChanged(["email", "phone", "privacy"], true);
    for (const group of groups) {
      expect([
        "identity",
        "contact",
        "professional",
        "relationships",
        "privacy",
        "photo",
        "other",
      ]).toContain(group);
    }
  });
});

describe("activeFilterKeys (P6 — which dimensions, never their values)", () => {
  const empty = {
    classYear: "",
    major: [],
    stateProvince: [],
    city: "",
    staff: "",
  };

  it("returns no dimensions for a pristine filter set", () => {
    expect(activeFilterKeys(empty).size).toBe(0);
  });

  it("marks a string filter active only when non-empty", () => {
    expect(activeFilterKeys({ ...empty, classYear: "1984" })).toEqual(new Set(["classYear"]));
    expect(activeFilterKeys({ ...empty, classYear: "  " }).size).toBe(0);
  });

  it("marks an array filter active only when it has entries", () => {
    expect(activeFilterKeys({ ...empty, major: ["6-3"] })).toEqual(new Set(["major"]));
    expect(activeFilterKeys({ ...empty, major: [] }).size).toBe(0);
  });

  it("reports multiple engaged dimensions at once", () => {
    expect(activeFilterKeys({ ...empty, classYear: "1984", stateProvince: ["MA"] })).toEqual(
      new Set(["classYear", "stateProvince"]),
    );
  });

  it("ignores keys that aren't tracked dimensions", () => {
    expect(activeFilterKeys({ ...empty, somethingElse: "value" }).size).toBe(0);
  });
});

describe("FILTER_DIMENSIONS labels (P6)", () => {
  it("labels are human dimension names, carrying no value", () => {
    expect(FILTER_DIMENSIONS.major).toBe("Course"); // UI "course" is stored as `major`
    expect(FILTER_DIMENSIONS.stateProvince).toBe("State/Province");
    expect(FILTER_DIMENSIONS.classYear).toBe("Class Year");
  });
});

describe("EventProperties catalog (type-level sanity)", () => {
  it("has an entry for each event a wrapper sends", () => {
    // A runtime touch of a representative property shape, so a rename here breaks a
    // test rather than silently drifting from the wrappers in analytics.ts.
    const sample: EventProperties["Profile Saved"] = { "Field Groups": ["contact"], Own: true };
    expect(sample.Own).toBe(true);
  });
});
