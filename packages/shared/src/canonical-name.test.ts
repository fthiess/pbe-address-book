import { describe, expect, it } from "vitest";
import {
  type CanonicalNameInput,
  buildAmbiguityIndex,
  canonicalNameKey,
  formatCanonicalName,
  resolveCanonicalNames,
} from "./canonical-name.js";

const brother = (over: Partial<CanonicalNameInput> & { id: number }): CanonicalNameInput => ({
  firstName: "James",
  lastName: "Smyth",
  classYear: 1984,
  ...over,
});

describe("formatCanonicalName", () => {
  it("renders the normal First Last 'YY form", () => {
    expect(formatCanonicalName(brother({ id: 5247 }), false)).toBe("James Smyth '84");
  });

  it("omits the year when the class year is unknown", () => {
    expect(formatCanonicalName(brother({ id: 5247, classYear: null }), false)).toBe("James Smyth");
  });

  it("appends the Constitution ID when ambiguous", () => {
    expect(formatCanonicalName(brother({ id: 5247 }), true)).toBe("James Smyth '84 (#5247)");
  });

  it("appends the ID on an ambiguous unknown-year name", () => {
    expect(formatCanonicalName(brother({ id: 5247, classYear: null }), true)).toBe(
      "James Smyth (#5247)",
    );
  });
});

describe("buildAmbiguityIndex / resolveCanonicalNames", () => {
  it("disambiguates two brothers who render identically", () => {
    const names = resolveCanonicalNames([
      brother({ id: 5247, firstName: "James", lastName: "Smyth", classYear: 1984 }),
      brother({ id: 5248, firstName: "James", lastName: "Smyth", classYear: 1984 }),
      brother({ id: 5249, firstName: "Robert", lastName: "Jonas", classYear: 1984 }),
    ]);
    expect(names.get(5247)).toBe("James Smyth '84 (#5247)");
    expect(names.get(5248)).toBe("James Smyth '84 (#5248)");
    // The unique name carries no disambiguator.
    expect(names.get(5249)).toBe("Robert Jonas '84");
  });

  it("collides on the two-digit token, so 1884 and 1984 are both disambiguated (§5.1)", () => {
    const a = brother({ id: 5247, classYear: 1884 });
    const b = brother({ id: 5248, classYear: 1984 });
    const ambiguous = buildAmbiguityIndex([a, b]);
    // Same displayed key despite different centuries.
    expect(canonicalNameKey(a)).toBe(canonicalNameKey(b));
    expect(ambiguous.has(canonicalNameKey(a))).toBe(true);
    const names = resolveCanonicalNames([a, b]);
    expect(names.get(5247)).toBe("James Smyth '84 (#5247)");
    expect(names.get(5248)).toBe("James Smyth '84 (#5248)");
  });

  it("treats two unknown-year same-name brothers as ambiguous", () => {
    const names = resolveCanonicalNames([
      brother({ id: 5247, classYear: null }),
      brother({ id: 5248, classYear: null }),
    ]);
    expect(names.get(5247)).toBe("James Smyth (#5247)");
    expect(names.get(5248)).toBe("James Smyth (#5248)");
  });

  it("folds case and surrounding whitespace when keying", () => {
    expect(canonicalNameKey(brother({ id: 1, firstName: " james " }))).toBe(
      canonicalNameKey(brother({ id: 2, firstName: "James" })),
    );
  });

  it("collapses EVERY internal whitespace run, not just the first (OFC-93)", () => {
    // Two separate internal runs: a non-global collapse leaves the second doubled,
    // so the messy and clean spellings would key apart and escape disambiguation.
    const messy = canonicalNameKey(brother({ id: 1, lastName: "van  der  Berg" }));
    const clean = canonicalNameKey(brother({ id: 2, lastName: "van der Berg" }));
    expect(messy).toBe(clean);
    const names = resolveCanonicalNames([
      brother({ id: 5247, lastName: "van  der  Berg" }),
      brother({ id: 5248, lastName: "van der Berg" }),
    ]);
    expect(names.get(5247)).toContain("(#5247)");
    expect(names.get(5248)).toContain("(#5248)");
  });
});
