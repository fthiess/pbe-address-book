import { describe, expect, it } from "vitest";
import type { DirectoryProfile } from "../../lib/types.js";
import {
  COLUMNS,
  type ColumnKey,
  type SortDirection,
  compareCanonical,
  makeComparator,
  selectableColumns,
  sortRows,
} from "./grid-model.js";

/** A minimal directory record — only the fields a given assertion exercises. */
function row(partial: Partial<DirectoryProfile> & Pick<DirectoryProfile, "id">): DirectoryProfile {
  return { firstName: "", lastName: "", classYear: null, ...partial };
}

const order = (
  rows: DirectoryProfile[],
  comparator: (a: DirectoryProfile, b: DirectoryProfile) => number,
) => [...rows].sort(comparator).map((r) => r.id);

describe("compareCanonical", () => {
  it("orders by last name, then first name, then class year", () => {
    const rows = [
      row({ id: 1, firstName: "Brett", lastName: "Smith", classYear: 1984 }),
      row({ id: 2, firstName: "Aaron", lastName: "Smith", classYear: 1990 }),
      row({ id: 3, firstName: "Aaron", lastName: "Adams", classYear: 1984 }),
      row({ id: 4, firstName: "Aaron", lastName: "Smith", classYear: 1984 }),
    ];
    expect(order(rows, compareCanonical)).toEqual([3, 4, 2, 1]);
  });

  it("compares names case- and locale-insensitively", () => {
    const lower = row({ id: 1, firstName: "amy", lastName: "vance" });
    const upper = row({ id: 2, firstName: "Amy", lastName: "Vance" });
    // Equal under base sensitivity → falls through to the year tiebreak (both
    // unknown), so the sort is stable and neither reorders ahead of the other.
    expect(compareCanonical(lower, upper)).toBe(0);
  });

  it("sorts an unknown class year after known ones for the same name", () => {
    const known = row({ id: 1, firstName: "Sam", lastName: "Lee", classYear: 1988 });
    const unknown = row({ id: 2, firstName: "Sam", lastName: "Lee", classYear: null });
    expect(compareCanonical(known, unknown)).toBeLessThan(0);
  });
});

describe("classYear column display", () => {
  it("renders the full 4-digit year, not the 'YY canonical form", () => {
    expect(COLUMNS.classYear.display(row({ id: 1, classYear: 1972 }), "")).toBe("1972");
    expect(COLUMNS.classYear.display(row({ id: 2, classYear: 2005 }), "")).toBe("2005");
  });

  it("shows the em-dash placeholder when the class year is unknown", () => {
    expect(COLUMNS.classYear.display(row({ id: 3, classYear: null }), "")).toBe("—");
  });
});

describe("makeComparator", () => {
  it("sorts the Name column by canonical order ascending and descending", () => {
    const rows = [
      row({ id: 1, firstName: "Aaron", lastName: "Adams" }),
      row({ id: 2, firstName: "Zane", lastName: "Young" }),
    ];
    expect(order(rows, makeComparator("name", "asc"))).toEqual([1, 2]);
    expect(order(rows, makeComparator("name", "desc"))).toEqual([2, 1]);
  });

  it("sorts a numeric column with the canonical name as the secondary key", () => {
    const rows = [
      row({ id: 1, firstName: "Brett", lastName: "Brown", classYear: 1984 }),
      row({ id: 2, firstName: "Aaron", lastName: "Adams", classYear: 1984 }),
      row({ id: 3, firstName: "Cyril", lastName: "Clark", classYear: 1980 }),
    ];
    // Year ascending, with the 1984 tie resolved into name order (Adams < Brown).
    expect(order(rows, makeComparator("classYear", "asc"))).toEqual([3, 2, 1]);
  });

  it("keeps absent values last in BOTH sort directions", () => {
    const rows = [
      row({ id: 1, firstName: "A", lastName: "A", email: "a@example.test" }),
      row({ id: 2, firstName: "B", lastName: "B" }), // no email → null sort value
      row({ id: 3, firstName: "C", lastName: "C", email: "c@example.test" }),
    ];
    // Ascending: present values ordered, null last.
    expect(order(rows, makeComparator("email", "asc"))).toEqual([1, 3, 2]);
    // Descending: present values reversed, null STILL last (the regression guard).
    expect(order(rows, makeComparator("email", "desc"))).toEqual([3, 1, 2]);
  });

  it("ties two absent values into canonical name order", () => {
    const rows = [
      row({ id: 1, firstName: "Zed", lastName: "Zimmer" }),
      row({ id: 2, firstName: "Amy", lastName: "Adams" }),
    ];
    expect(order(rows, makeComparator("phone", "asc"))).toEqual([2, 1]);
  });
});

describe("sortRows (decorate-sort-undecorate, OFC-104)", () => {
  // A fixture exercising every sort shape: present/absent country keys (the
  // locale-heavy path), a numeric column, and ties that fall to the canonical key.
  const rows = [
    row({ id: 1, firstName: "Brett", lastName: "Brown", classYear: 1984 }),
    row({ id: 2, firstName: "Aaron", lastName: "Adams", classYear: 1984 }),
    row({ id: 3, firstName: "Cyril", lastName: "Clark", classYear: 1980 }),
    row({ id: 4, firstName: "Zed", lastName: "Zimmer" }), // no classYear → null
  ];

  const keys: ColumnKey[] = ["name", "classYear", "email", "country"];
  const directions: SortDirection[] = ["asc", "desc"];

  it("orders identically to makeComparator for every key and direction", () => {
    for (const key of keys) {
      for (const direction of directions) {
        const viaSort = sortRows(rows, key, direction).map((r) => r.id);
        const viaComparator = [...rows].sort(makeComparator(key, direction)).map((r) => r.id);
        expect(viaSort, `${key}/${direction}`).toEqual(viaComparator);
      }
    }
  });

  it("derives each row's sort key exactly once (O(n), not per-comparison)", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      row({ id: i + 1, firstName: `F${i}`, lastName: `L${i % 7}`, classYear: 1980 + (i % 20) }),
    );
    let derivations = 0;
    const original = COLUMNS.classYear.sortValue;
    // Wrap the column's key accessor to count derivations for this one sort.
    (COLUMNS.classYear as { sortValue: typeof original }).sortValue = (p) => {
      derivations += 1;
      return original(p);
    };
    try {
      sortRows(many, "classYear", "asc");
    } finally {
      (COLUMNS.classYear as { sortValue: typeof original }).sortValue = original;
    }
    // Exactly one derivation per row — never the O(n log n) the comparator incurs.
    expect(derivations).toBe(many.length);
  });

  it("returns a new array, leaving the input order untouched", () => {
    const input = [...rows];
    const sorted = sortRows(input, "classYear", "asc");
    expect(sorted).not.toBe(input);
    expect(input.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("selectableColumns", () => {
  const keysFor = (role: Parameters<typeof selectableColumns>[0]) =>
    selectableColumns(role).map((c) => c.key);

  it("excludes pinned identity columns from the lens menu", () => {
    expect(keysFor("brother")).not.toContain<ColumnKey>("name");
    expect(keysFor("brother")).not.toContain<ColumnKey>("thumbnail");
  });

  it("hides restricted columns from brothers but offers them to staff", () => {
    expect(keysFor("brother")).not.toContain<ColumnKey>("allowNewsletterEmail");
    expect(keysFor("manager")).toContain<ColumnKey>("allowNewsletterEmail");
    expect(keysFor("admin")).toContain<ColumnKey>("lastModified");
  });

  it("offers the role-identical default data columns to every role", () => {
    for (const role of ["brother", "manager", "admin"] as const) {
      expect(keysFor(role)).toContain<ColumnKey>("email");
      expect(keysFor(role)).toContain<ColumnKey>("country");
    }
  });

  it("every restricted column is staff-gated", () => {
    for (const column of Object.values(COLUMNS)) {
      if (column.group === "restricted") {
        expect(column.roles).toEqual(["manager", "admin"]);
      }
    }
  });
});
