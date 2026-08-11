import { describe, expect, it } from "vitest";
import type { DirectoryProfile } from "../../lib/types.js";
import { displayedColumnsToCsv } from "./displayed-csv.js";
import type { ColumnKey } from "./grid-model.js";

/** A minimal directory record — only the fields a given assertion exercises. */
function row(partial: Partial<DirectoryProfile> & Pick<DirectoryProfile, "id">): DirectoryProfile {
  return { firstName: "", lastName: "", classYear: null, ...partial };
}

/**
 * The Directory passes its resolved Canonical Names in; here, a readable stand-in.
 * Deliberately **comma-free**, unlike a real Canonical Name ("Smyth, James '84"),
 * so that {@link parse} — a naive split on commas — stays honest. Quoting is
 * asserted directly, on its own case, rather than everywhere by accident.
 */
const nameOf = (p: DirectoryProfile) => `${p.lastName} ${p.firstName}`.trim();

/** Split the CSV back into rows and cells for assertions that don't care about quoting. */
function parse(csv: string): string[][] {
  return csv.split("\r\n").map((line) => line.split(","));
}

/** One row's cells, asserted to exist — the repo compiles with `noUncheckedIndexedAccess`. */
function cells(csv: string, line: number): string[] {
  const parsed = parse(csv)[line];
  expect(parsed).toBeDefined();
  return parsed as string[];
}

describe("displayedColumnsToCsv (OFC-403)", () => {
  it("leads with the Name column, then the lens columns in the user's order", () => {
    const csv = displayedColumnsToCsv(
      [row({ id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 })],
      ["phone", "classYear"],
      nameOf,
    );
    const [header, first] = parse(csv);
    // "Class" after "Telephone" — the lens order, not the registry's.
    expect(header).toEqual(["Name", "Telephone", "Class"]);
    expect(first).toEqual(["Smyth James", "", "1984"]);
  });

  it("uses the grid's header labels, not the schema's field names", () => {
    // The whole point of the second export: it is readable, not round-trippable.
    // `Course`/`Staff`/`Telephone` are what the reader saw at the top of the column.
    const csv = displayedColumnsToCsv([], ["major", "role", "phone"], nameOf);
    expect(parse(csv)[0]).toEqual(["Name", "Course", "Staff", "Telephone"]);
  });

  it("writes an empty cell where the grid shows an em-dash", () => {
    // A literal "—" would break every COUNTA, sort and filter the recipient runs.
    const csv = displayedColumnsToCsv([row({ id: 1 })], ["email", "phone", "city"], nameOf);
    expect(parse(csv)[1]).toEqual(["", "", "", ""]);
    expect(csv).not.toContain("—");
  });

  it("writes every course, matching the chip strip the cell renders", () => {
    // `display` returns the primary course alone (it exists for sorting), so a
    // naive export would say "6" of a cell reading "6, 18". Guards `csvValue`.
    const csv = displayedColumnsToCsv([row({ id: 1, majors: ["6", "18"] })], ["major"], nameOf);
    expect(cells(csv, 1)[1]).toBe("6;18");
  });

  it("writes the display string, not the stored code", () => {
    const csv = displayedColumnsToCsv(
      [row({ id: 1, address: { country: "US", stateProvince: "MA" } })],
      ["country", "stateProvince"],
      nameOf,
    );
    expect(cells(csv, 1).slice(1)).toEqual(["United States", "Massachusetts"]);
  });

  it("neutralises a formula-injection attempt in a displayed value (S9/OFC-99)", () => {
    // The same `formatCsvCell` the canonical export uses — asserted here too,
    // because a second export is a second place the hardening could be forgotten.
    const csv = displayedColumnsToCsv(
      [row({ id: 1, employerName: "=cmd|'/c calc'!A1" })],
      ["employer"],
      nameOf,
    );
    expect(csv).toContain("'=cmd");
  });

  it("RFC-4180-escapes a value containing a comma", () => {
    const csv = displayedColumnsToCsv(
      [row({ id: 1, employerName: "Smyth, Sons & Co" })],
      ["employer"],
      nameOf,
    );
    expect(csv).toContain('"Smyth, Sons & Co"');
  });

  it("emits a header-only file for an empty selection", () => {
    expect(displayedColumnsToCsv([], ["email"], nameOf)).toBe("Name,Email");
  });

  it("emits the Name column alone when the lens is somehow empty", () => {
    // `parseLens` substitutes the default lens rather than yielding an empty one,
    // so this is a defensive case — but a file of blank lines would be worse than
    // a file of names, and the difference is one line of code.
    const csv = displayedColumnsToCsv([row({ id: 1, firstName: "A", lastName: "B" })], [], nameOf);
    expect(parse(csv)).toEqual([["Name"], ["B A"]]);
  });

  it("terminates lines with CRLF, like the canonical export", () => {
    const csv = displayedColumnsToCsv([row({ id: 1 }), row({ id: 2 })], ["email"], nameOf);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("exports exactly the columns it is given — it does not re-filter by role", () => {
    // The lens is already role-filtered by `parseLens`, which drops any key the
    // role may not select. This asserts the division of labour rather than the
    // outcome: if that filtering ever moves, this test is where it will be noticed.
    const staffOnly: ColumnKey[] = ["lastVerifiedDate", "allowNewsletterEmail"];
    const csv = displayedColumnsToCsv([row({ id: 1 })], staffOnly, nameOf);
    expect(parse(csv)[0]).toEqual(["Name", "Last verified", "Newsletter"]);
  });
});
