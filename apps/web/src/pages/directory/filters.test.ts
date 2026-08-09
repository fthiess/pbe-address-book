import { describe, expect, it } from "vitest";
import type { DirectoryProfile } from "../../lib/types.js";
import {
  EMPTY_FILTERS,
  buildFilterPredicate,
  collectFilterOptions,
  countActiveFilters,
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

  it("parses one-sided ranges as an open (null) bound (OFC-195)", () => {
    // `1985-` → that year and later; `-1990` → that year and earlier.
    expect(parseNumericGrammar("1985-").ranges).toEqual([[1985, null]]);
    expect(parseNumericGrammar("-1990").ranges).toEqual([[null, 1990]]);
    // Whitespace around the dash is tolerated, same as closed ranges.
    expect(parseNumericGrammar(" 1985 - ").ranges).toEqual([[1985, null]]);
    expect(parseNumericGrammar(" - 1990 ").ranges).toEqual([[null, 1990]]);
  });

  it("combines one-sided ranges with lists and closed ranges", () => {
    const g = parseNumericGrammar("1980, 1985-1989, 1992-, -1975");
    expect(g.values).toEqual([1980]);
    expect(g.ranges).toEqual([
      [1985, 1989],
      [1992, null],
      [null, 1975],
    ]);
    expect(g.errors).toEqual([]);
  });

  it("collects unparseable tokens rather than dropping them silently", () => {
    // A bare `-` has no bound on either side and is an error, not an open range.
    const g = parseNumericGrammar("1980, abc, 19-x, -");
    expect(g.values).toEqual([1980]);
    expect(g.errors).toEqual(["abc", "19-x", "-"]);
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

  it("matches one-sided year ranges through the predicate (OFC-195)", () => {
    // `1985-` keeps only the class of 1990; `-1985` keeps the two 1984s.
    expect(keep(buildFilterPredicate({ ...EMPTY_FILTERS, classYear: "1985-" }, "brother"))).toEqual(
      [2],
    );
    expect(keep(buildFilterPredicate({ ...EMPTY_FILTERS, classYear: "-1985" }, "brother"))).toEqual(
      [1, 3],
    );
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

describe("buildFilterPredicate — Employer (D164, OFC-379)", () => {
  const rows = [
    p({ id: 1, classYear: 1984, employerName: "Acme Corporation" }),
    p({ id: 2, classYear: 1990, employerName: "acme labs" }),
    p({ id: 3, classYear: 1984, employerName: "Initech" }),
    // No employer on record — the field is optional, and "not set" is
    // indistinguishable from "not visible" to the client by design.
    p({ id: 4, classYear: 1984 }),
  ];
  const keep = (filters: Partial<typeof EMPTY_FILTERS>, role: "brother" | "manager" | "admin") =>
    rows.filter(buildFilterPredicate({ ...EMPTY_FILTERS, ...filters }, role)).map((r) => r.id);

  it("matches as a case-insensitive substring, like City", () => {
    expect(keep({ employer: "acme" }, "brother")).toEqual([1, 2]);
    expect(keep({ employer: "CORP" }, "brother")).toEqual([1]);
  });

  it("never matches a brother with no employer on record", () => {
    // "e" is in all three populated values ("Acme", "acme", "Initech"), so the ONLY
    // row that can drop out is the one with no employer — which is what makes this
    // an absence test rather than another substring test.
    expect(keep({ employer: "e" }, "brother")).toEqual([1, 2, 3]);
  });

  it("treats a whitespace-only value as unset (the filter must not exclude everyone)", () => {
    expect(keep({ employer: "   " }, "brother")).toEqual([1, 2, 3, 4]);
  });

  it("is available to EVERY role — `employerName` is public, so filterable ⟺ visible", () => {
    for (const role of ["brother", "manager", "admin"] as const) {
      expect(keep({ employer: "initech" }, role)).toEqual([3]);
    }
  });

  it("ANDs with another field (D38)", () => {
    expect(keep({ employer: "acme", classYear: "1984" }, "brother")).toEqual([1]);
  });
});

describe("buildFilterPredicate — the three free-text fields (OFC-404/405/406)", () => {
  const rows = [
    p({
      id: 1,
      classYear: 1984,
      postPbeEducation: "Ph.D. in Computer Science, Stanford",
      sports: "Varsity soccer and basketball",
      activities: "Community orchestra, second violin",
    }),
    p({ id: 2, classYear: 1990, postPbeEducation: "MBA, Wharton", sports: "Golf and fishing" }),
    p({ id: 3, classYear: 1984, activities: "Beekeeping and cider making" }),
    // Nothing filled in — the case that will describe most of the roster for a long
    // while, since these fields ship empty for every existing record.
    p({ id: 4, classYear: 1984 }),
  ];
  const keep = (filters: Partial<typeof EMPTY_FILTERS>, role: "brother" | "manager" | "admin") =>
    rows.filter(buildFilterPredicate({ ...EMPTY_FILTERS, ...filters }, role)).map((r) => r.id);

  it("matches each field as a case-insensitive substring", () => {
    expect(keep({ postPbeEducation: "stanford" }, "brother")).toEqual([1]);
    expect(keep({ sports: "GOLF" }, "brother")).toEqual([2]);
    expect(keep({ activities: "beekeeping" }, "brother")).toEqual([3]);
  });

  it("matches inside the line, not only at its start", () => {
    // The contract that makes these useful: a brother wrote a phrase, and another
    // brother searches for one word of it.
    expect(keep({ sports: "soccer" }, "brother")).toEqual([1]);
    expect(keep({ postPbeEducation: "wharton" }, "brother")).toEqual([2]);
  });

  it("never matches a brother who left the field empty", () => {
    // "a" appears in every populated value of each field, so the only rows that can
    // drop are the ones with nothing on record — an absence test, not a substring one.
    expect(keep({ sports: "a" }, "brother")).toEqual([1, 2]);
    expect(keep({ activities: "a" }, "brother")).toEqual([1, 3]);
  });

  it("treats a whitespace-only value as unset, so the filter excludes nobody", () => {
    expect(keep({ sports: "   " }, "brother")).toEqual([1, 2, 3, 4]);
  });

  it("is available to EVERY role — all three fields are public, so filterable ⟺ visible", () => {
    for (const role of ["brother", "manager", "admin"] as const) {
      expect(keep({ activities: "orchestra" }, role)).toEqual([1]);
    }
  });

  it("ANDs across the three, and with other fields (D38)", () => {
    expect(keep({ sports: "soccer", activities: "orchestra" }, "brother")).toEqual([1]);
    // Both brothers played a sport; only one is '84.
    expect(keep({ sports: "and", classYear: "1984" }, "brother")).toEqual([1]);
    // AND across the three with no common row yields nothing.
    expect(keep({ sports: "golf", activities: "beekeeping" }, "brother")).toEqual([]);
  });
});

describe("countActiveFilters", () => {
  it("counts nothing for a pristine filter set", () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
  });

  it("counts each constraining field once, and ignores whitespace-only text", () => {
    expect(countActiveFilters({ ...EMPTY_FILTERS, employer: "acme" })).toBe(1);
    expect(countActiveFilters({ ...EMPTY_FILTERS, employer: "  " })).toBe(0);
    expect(countActiveFilters({ ...EMPTY_FILTERS, employer: "acme", city: "boston" })).toBe(2);
  });

  it("counts every filter field, so a new filter cannot be left out of the badge", () => {
    // Every key set to a constraining value → the count must equal the field count.
    // This is the assertion that fails if a filter is added to the model and its
    // line is forgotten here (the panel badge and the pristine-URL check both
    // read this number).
    const all = {
      ...EMPTY_FILTERS,
      classYear: "1984",
      constitutionId: "721",
      major: ["6-3"],
      country: ["US"],
      stateProvince: ["MA"],
      city: "boston",
      employer: "acme",
      postPbeEducation: "stanford",
      sports: "soccer",
      activities: "sailing",
      staff: "staffOnly" as const,
      willingToMentor: "yes" as const,
      deceasedOnly: "yes" as const,
      email: "has" as const,
      phone: "has" as const,
      unlisted: "yes" as const,
      debrothered: "yes" as const,
      allowNewsletterEmail: "yes" as const,
      allowShareWithMITAA: "yes" as const,
      verification: "verified" as const,
      verifiedBefore: "2026-01-01",
    };
    expect(countActiveFilters(all)).toBe(Object.keys(EMPTY_FILTERS).length);
  });
});

describe("buildFilterPredicate — Staff filter (all roles, OFC-199)", () => {
  const rows = [
    p({ id: 1, role: "brother" }),
    p({ id: 2, role: "manager" }),
    p({ id: 3, role: "admin" }),
    p({ id: 4 }), // no role on the wire → treated as an ordinary brother
  ];
  const keptFor = (viewer: "brother" | "manager" | "admin") =>
    rows
      .filter(buildFilterPredicate({ ...EMPTY_FILTERS, staff: "staffOnly" }, viewer))
      .map((r) => r.id);

  it("keeps only managers and administrators", () => {
    expect(keptFor("brother")).toEqual([2, 3]);
  });

  it("is available to every viewing role, not just staff (role is public, OFC-139)", () => {
    expect(keptFor("manager")).toEqual([2, 3]);
    expect(keptFor("admin")).toEqual([2, 3]);
  });
});

describe("buildFilterPredicate — Willing to mentor (all roles, D166/OFC-386)", () => {
  const living = { isDeceased: false };
  const rows = [
    p({ id: 1, willingToMentor: true, deceased: living }),
    p({ id: 2, willingToMentor: false, deceased: living }),
    p({ id: 3, deceased: living }), // field absent on the wire → not willing
    // Opted in during his life, since deceased. "Include deceased" (D36) is the only
    // way he reaches the grid at all — and when he does, he must not be offered.
    p({ id: 4, willingToMentor: true, deceased: { isDeceased: true } }),
  ];
  const keptFor = (viewer: "brother" | "manager" | "admin") =>
    rows
      .filter(buildFilterPredicate({ ...EMPTY_FILTERS, willingToMentor: "yes" }, viewer))
      .map((r) => r.id);

  it("keeps only living brothers who opted in", () => {
    expect(keptFor("brother")).toEqual([1]);
  });

  it("is available to every viewing role — the field is public (D166)", () => {
    expect(keptFor("manager")).toEqual([1]);
    expect(keptFor("admin")).toEqual([1]);
  });

  it("constrains nothing when unset", () => {
    const kept = rows.filter(buildFilterPredicate(EMPTY_FILTERS, "brother")).map((r) => r.id);
    expect(kept).toEqual([1, 2, 3, 4]);
  });
});

describe("buildFilterPredicate — Deceased (all roles, OFC-399/D171)", () => {
  const rows = [
    p({ id: 1, deceased: { isDeceased: false } }),
    p({ id: 2, deceased: { isDeceased: true } }),
    p({ id: 3 }), // block absent from the projection → not deceased, never "unknown"
  ];
  const keptFor = (viewer: "brother" | "manager" | "admin") =>
    rows
      .filter(buildFilterPredicate({ ...EMPTY_FILTERS, deceasedOnly: "yes" }, viewer))
      .map((r) => r.id);

  it("keeps only brothers flagged deceased", () => {
    expect(keptFor("brother")).toEqual([2]);
  });

  it("is available to every viewing role — the flag is public", () => {
    expect(keptFor("manager")).toEqual([2]);
    expect(keptFor("admin")).toEqual([2]);
  });

  it("constrains nothing when unset", () => {
    expect(rows.filter(buildFilterPredicate(EMPTY_FILTERS, "brother")).map((r) => r.id)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("buildFilterPredicate — Unlisted and De-brothered (staff-only, OFC-399)", () => {
  const rows = [
    p({ id: 1, unlisted: false, debrothered: { isDebrothered: false } }),
    p({ id: 2, unlisted: true, debrothered: { isDebrothered: false } }),
    p({ id: 3, unlisted: false, debrothered: { isDebrothered: true } }),
    p({ id: 4 }), // neither field on the wire → hidden by neither
  ];
  const kept = (
    filters: Parameters<typeof buildFilterPredicate>[0],
    viewer: "brother" | "manager" | "admin",
  ) => rows.filter(buildFilterPredicate(filters, viewer)).map((r) => r.id);

  // Both staff roles, not just admin: `canUseStaffFilters` gates on manager OR
  // admin, so an admin-only assertion would pass unchanged if the gate were ever
  // narrowed to admin — and "managers and administrators" is what the panel's own
  // divider and the user manual promise.
  it("keeps only unlisted records for staff", () => {
    expect(kept({ ...EMPTY_FILTERS, unlisted: "yes" }, "admin")).toEqual([2]);
    expect(kept({ ...EMPTY_FILTERS, unlisted: "yes" }, "manager")).toEqual([2]);
  });

  it("keeps only de-brothered records for staff", () => {
    expect(kept({ ...EMPTY_FILTERS, debrothered: "yes" }, "admin")).toEqual([3]);
    expect(kept({ ...EMPTY_FILTERS, debrothered: "yes" }, "manager")).toEqual([3]);
  });

  it("AND-composes: no record is both, so the pair yields nothing", () => {
    expect(kept({ ...EMPTY_FILTERS, unlisted: "yes", debrothered: "yes" }, "admin")).toEqual([]);
  });

  it("treats an absent flag as 'not hidden', never as a reason to keep the record", () => {
    // The record with neither field present must not survive either filter — a
    // projection that omits the field must not read as a match (the same defensive
    // rule the email-recipient rules follow for `unlisted`).
    expect(kept({ ...EMPTY_FILTERS, unlisted: "yes" }, "admin")).not.toContain(4);
    expect(kept({ ...EMPTY_FILTERS, debrothered: "yes" }, "admin")).not.toContain(4);
  });

  it("is ignored for a brother — the fields are staff-internal and never projected to him", () => {
    expect(kept({ ...EMPTY_FILTERS, unlisted: "yes" }, "brother")).toEqual([1, 2, 3, 4]);
    expect(kept({ ...EMPTY_FILTERS, debrothered: "yes" }, "brother")).toEqual([1, 2, 3, 4]);
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
