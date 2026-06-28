import { describe, expect, it } from "vitest";
import type { DirectoryProfile } from "../../lib/types.js";
import {
  EMPTY_FILTERS,
  buildFilterPredicate,
  collectFilterOptions,
  parseNumericGrammar,
} from "./filters.js";

function p(partial: Partial<DirectoryProfile> & Pick<DirectoryProfile, "id">): DirectoryProfile {
  return partial;
}

describe("parseNumericGrammar", () => {
  it("parses comma lists and dash ranges, combined", () => {
    const g = parseNumericGrammar("1980, 1985-1989, 1992");
    expect(g.values).toEqual([1980, 1992]);
    expect(g.ranges).toEqual([[1985, 1989]]);
    expect(g.errors).toEqual([]);
    expect(g.active).toBe(true);
  });

  it("normalises a reversed range and tolerates whitespace", () => {
    expect(parseNumericGrammar(" 1990 - 1980 ").ranges).toEqual([[1980, 1990]]);
  });

  it("collects unparseable tokens rather than dropping them silently", () => {
    const g = parseNumericGrammar("1980, abc, 19-x");
    expect(g.values).toEqual([1980]);
    expect(g.errors).toEqual(["abc", "19-x"]);
  });

  it("is inactive on empty or whitespace-only input", () => {
    expect(parseNumericGrammar("").active).toBe(false);
    expect(parseNumericGrammar("  ,  ").active).toBe(false);
  });
});

describe("buildFilterPredicate — composition (D38)", () => {
  const rows = [
    p({ id: 1, classYear: 1984, majors: ["6-3"], address: { country: "US", city: "Boston" } }),
    p({
      id: 2,
      classYear: 1990,
      majors: ["18", "6-3"],
      address: { country: "CA", city: "Toronto" },
    }),
    p({ id: 3, classYear: 1984, majors: ["10"], address: { country: "US", city: "Cambridge" } }),
  ];
  const keep = (pred: (r: DirectoryProfile) => boolean) => rows.filter(pred).map((r) => r.id);

  it("matches a numeric grammar over class year", () => {
    const pred = buildFilterPredicate({ ...EMPTY_FILTERS, classYear: "1984" }, "brother");
    expect(keep(pred)).toEqual([1, 3]);
  });

  it("ORs within the Course multi-select (any major matches)", () => {
    const pred = buildFilterPredicate({ ...EMPTY_FILTERS, major: ["6-3"] }, "brother");
    expect(keep(pred)).toEqual([1, 2]);
  });

  it("ANDs across fields (class year AND country)", () => {
    const pred = buildFilterPredicate(
      { ...EMPTY_FILTERS, classYear: "1984", country: ["US"] },
      "brother",
    );
    expect(keep(pred)).toEqual([1, 3]);
  });

  it("matches City as a case-insensitive substring", () => {
    const pred = buildFilterPredicate({ ...EMPTY_FILTERS, city: "cam" }, "brother");
    expect(keep(pred)).toEqual([3]);
  });
});

describe("buildFilterPredicate — staff gating (filterable ⟺ visible)", () => {
  const withEmail = p({ id: 1, email: "a@example.test" });
  const noEmail = p({ id: 2 });

  it("applies the email-presence filter for staff", () => {
    const pred = buildFilterPredicate({ ...EMPTY_FILTERS, email: "missing" }, "manager");
    expect([withEmail, noEmail].filter(pred).map((r) => r.id)).toEqual([2]);
  });

  it("ignores a staff-only filter for a brother (it can't constrain projected-away data)", () => {
    const pred = buildFilterPredicate({ ...EMPTY_FILTERS, email: "missing" }, "brother");
    // No staff clause is added, so both rows pass.
    expect([withEmail, noEmail].filter(pred).map((r) => r.id)).toEqual([1, 2]);
  });

  it("filters never-verified records for staff", () => {
    const verified = p({ id: 1, lastVerifiedDate: "2026-01-01" });
    const never = p({ id: 2 });
    const pred = buildFilterPredicate({ ...EMPTY_FILTERS, verification: "never" }, "admin");
    expect([verified, never].filter(pred).map((r) => r.id)).toEqual([2]);
  });

  it("treats 'not verified since' as never-verified OR stale", () => {
    const fresh = p({ id: 1, lastVerifiedDate: "2026-06-01" });
    const stale = p({ id: 2, lastVerifiedDate: "2024-01-01" });
    const never = p({ id: 3 });
    const pred = buildFilterPredicate({ ...EMPTY_FILTERS, verifiedBefore: "2026-01-01" }, "admin");
    expect([fresh, stale, never].filter(pred).map((r) => r.id)).toEqual([2, 3]);
  });
});

describe("collectFilterOptions", () => {
  it("draws distinct, label-sorted options from values present in the data", () => {
    const options = collectFilterOptions([
      p({ id: 1, majors: ["6-3"], address: { country: "US", stateProvince: "MA" } }),
      p({ id: 2, majors: ["18", "6-3"], address: { country: "CA", stateProvince: "ON" } }),
    ]);
    // Course options sort by course NUMBER (6 before 18), not as strings.
    expect(options.major.map((o) => o.value)).toEqual(["6-3", "18"]);
    expect(options.country.map((o) => o.value).sort()).toEqual(["CA", "US"]);
    // State labels resolve through the controlled vocabulary.
    expect(options.stateProvince.find((o) => o.value === "MA")?.label).toContain("Massachusetts");
  });
});
