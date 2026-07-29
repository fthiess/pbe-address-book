import { describe, expect, it } from "vitest";
import { mobileSortKeys } from "./mobile-sort.js";

/**
 * The phone Sort control's field list (OFC-364). Pure derivation — the control's
 * rendering and its effect on row order are covered e2e.
 */
describe("mobileSortKeys", () => {
  it("offers Canonical Name first, then the visible data fields in lens order", () => {
    expect(mobileSortKeys(["classYear", "email"], "name", "brother")).toEqual([
      "name",
      "classYear",
      "email",
    ]);
  });

  it("offers Name alone when the lens is empty", () => {
    expect(mobileSortKeys([], "name", "brother")).toEqual(["name"]);
  });

  it("drops a visible-but-unsortable field (the thumbnail never sorts)", () => {
    expect(mobileSortKeys(["thumbnail", "email"], "name", "brother")).toEqual(["name", "email"]);
  });

  it("never duplicates Name when the lens somehow carries it", () => {
    expect(mobileSortKeys(["name", "email"], "name", "brother")).toEqual(["name", "email"]);
  });

  it("appends the active field when the lens hides it, so the select can't misreport the sort", () => {
    // `?sort=email&cols=classYear` — the sort in force names a field the lens hides.
    expect(mobileSortKeys(["classYear"], "email", "brother")).toEqual([
      "name",
      "classYear",
      "email",
    ]);
  });

  it("withholds a staff-only active field from a brother (a hand-edited ?sort= can't leak a label)", () => {
    expect(mobileSortKeys(["classYear"], "lastModified", "brother")).toEqual(["name", "classYear"]);
    expect(mobileSortKeys(["classYear"], "lastModified", "manager")).toEqual([
      "name",
      "classYear",
      "lastModified",
    ]);
  });

  it("offers a staff field that is genuinely in a manager's lens", () => {
    expect(mobileSortKeys(["lastVerifiedDate"], "name", "admin")).toEqual([
      "name",
      "lastVerifiedDate",
    ]);
  });
});
