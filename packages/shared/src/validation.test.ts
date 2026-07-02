import { describe, expect, it } from "vitest";
import type { Profile } from "./types.js";
import { type ValidationContext, normalizePhone, validateProfile } from "./validation.js";

const CTX: ValidationContext = { currentYear: 2026, validMajorCodes: new Set(["6-3", "18"]) };

/** The dotted field names flagged by a validation run, for terse assertions. */
function fields(input: Partial<Profile>, ctx: ValidationContext = CTX): string[] {
  return validateProfile(input, ctx).issues.map((issue) => issue.field);
}

/** A minimal valid candidate edit (partial — present fields only). */
const valid: Partial<Profile> = {
  id: 5247,
  firstName: "James",
  lastName: "Smyth",
  classYear: 1984,
  email: "james@example.test",
};

describe("validateProfile — accepts valid input", () => {
  it("passes a clean partial edit", () => {
    expect(validateProfile(valid, CTX)).toEqual({ ok: true, issues: [] });
  });

  it("accepts a null class year (unknown)", () => {
    expect(fields({ classYear: null })).toEqual([]);
  });

  it("accepts free-text state for a non-US/CA country", () => {
    expect(fields({ address: { country: "GB", stateProvince: "Greater London" } })).toEqual([]);
  });
});

describe("validateProfile — required fields (create)", () => {
  it("flags missing required names and class year when requireRequired is set", () => {
    const result = fields({}, { ...CTX, requireRequired: true });
    expect(result).toContain("firstName");
    expect(result).toContain("lastName");
    expect(result).toContain("classYear");
  });

  it("ignores absent fields on a partial edit (no requireRequired)", () => {
    expect(fields({ email: "x@example.test" })).toEqual([]);
  });

  it("rejects a present-but-empty first name", () => {
    expect(fields({ firstName: "   " })).toEqual(["firstName"]);
  });
});

describe("validateProfile — class year range (§8)", () => {
  it("rejects a year below 1890 or beyond currentYear + 6", () => {
    expect(fields({ classYear: 1492 })).toEqual(["classYear"]);
    expect(fields({ classYear: 2033 })).toEqual(["classYear"]);
  });
  it("accepts the future margin (currentYear + 6)", () => {
    expect(fields({ classYear: 2032 })).toEqual([]);
  });
});

describe("validateProfile — email rules (§8/D97)", () => {
  it("rejects a malformed email", () => {
    expect(fields({ email: "not-an-email" })).toEqual(["email"]);
  });
  it("rejects an alternate email with no primary on the record", () => {
    expect(fields({ alternateEmail: "alt@example.test" })).toContain("alternateEmail");
  });
  it("accepts an alternate email when a primary is present", () => {
    expect(fields({ email: "p@example.test", alternateEmail: "a@example.test" })).toEqual([]);
  });
});

describe("validateProfile — address (§8/D37)", () => {
  it("rejects an unknown country code", () => {
    expect(fields({ address: { country: "ZZ" } })).toEqual(["address.country"]);
  });
  it("rejects an invalid US state code", () => {
    expect(fields({ address: { country: "US", stateProvince: "ZZ" } })).toEqual([
      "address.stateProvince",
    ]);
  });
  it("accepts a valid US state code", () => {
    expect(fields({ address: { country: "US", stateProvince: "MA" } })).toEqual([]);
  });
  it("checks US ZIP format (NNNNN or NNNNN-NNNN) but leaves other countries free (N38)", () => {
    expect(fields({ address: { country: "US", postalCode: "02139" } })).toEqual([]);
    expect(fields({ address: { country: "US", postalCode: "02139-4307" } })).toEqual([]);
    expect(fields({ address: { country: "US", postalCode: "2139" } })).toEqual([
      "address.postalCode",
    ]);
    expect(fields({ address: { country: "US", postalCode: "ABCDE" } })).toEqual([
      "address.postalCode",
    ]);
    // Non-US postal codes are not format-checked.
    expect(fields({ address: { country: "GB", postalCode: "SW1A 1AA" } })).toEqual([]);
  });
});

describe("validateProfile — collections", () => {
  it("rejects duplicate majors and unknown codes against the vocabulary", () => {
    expect(fields({ majors: ["6-3", "6-3"] })).toContain("majors.1");
    expect(fields({ majors: ["nope"] })).toContain("majors.0");
  });
  it("rejects more than five links and a non-http(s) URL scheme (D107)", () => {
    expect(fields({ links: Array(6).fill({ label: "x", url: "https://example.test" }) })).toContain(
      "links",
    );
    expect(fields({ links: [{ label: "x", url: "javascript:alert(1)" }] })).toEqual([
      "links.0.url",
    ]);
  });
  it("rejects more than two emergency contacts and a bad contact phone", () => {
    expect(fields({ emergencyContacts: [{}, {}, {}] })).toContain("emergencyContacts");
    expect(fields({ emergencyContacts: [{ phone: "letters" }] })).toEqual([
      "emergencyContacts.0.phone",
    ]);
  });
});

describe("validateProfile — malformed (non-string) input is flagged, not thrown (OFC-89)", () => {
  it("flags a JSON null on a string field instead of throwing a TypeError", () => {
    expect(fields({ email: null as unknown as string })).toContain("email");
    expect(fields({ phone: null as unknown as string })).toContain("phone");
    expect(fields({ address: { country: null as unknown as string } })).toContain(
      "address.country",
    );
  });

  it("tolerates a null address or deceased object without throwing", () => {
    expect(() => fields({ address: null as unknown as undefined })).not.toThrow();
    expect(() => fields({ deceased: null as unknown as undefined })).not.toThrow();
  });
});

describe("normalizePhone — canonical form (N35)", () => {
  it("formats a NANP number to +1 (AAA) BBB-CCCC from any accepted shape", () => {
    // Both accepted NANP shapes, with and without the country code, converge.
    expect(normalizePhone("(617) 555-1234")).toBe("+1 (617) 555-1234");
    expect(normalizePhone("617-555-1234")).toBe("+1 (617) 555-1234");
    expect(normalizePhone("+1 617-555-1234")).toBe("+1 (617) 555-1234");
    expect(normalizePhone("+1 (617) 555-1234")).toBe("+1 (617) 555-1234");
    expect(normalizePhone("16175551234")).toBe("+1 (617) 555-1234");
    expect(normalizePhone("  617.555.1234  ")).toBe("+1 (617) 555-1234");
  });

  it("reduces a non-NANP international number to E.164 (no NANP grouping)", () => {
    expect(normalizePhone("+44 20 7123 4567")).toBe("+442071234567");
    expect(normalizePhone("+52 55 1234 5678")).toBe("+525512345678");
  });

  it("requires a country code when a bare number is not a NANP length", () => {
    // No leading + and not 10 (or 11-with-1) digits → ambiguous → rejected.
    expect(normalizePhone("2071234567890")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });

  it("rejects empties, letters, and out-of-range lengths", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone("letters")).toBeNull();
    expect(normalizePhone("+1 (617) 555-12ab")).toBeNull();
  });

  it("rejects a +1 (NANP) number that is not exactly 11 digits, with or without the +", () => {
    // A `+1` code is NANP and must be 1 + 10 digits — a too-short/too-long one must
    // not slip through the generic E.164 branch just because it carries a leading +.
    expect(normalizePhone("+16175551")).toBeNull(); // too short
    expect(normalizePhone("+161755513456789")).toBeNull(); // too long
    expect(normalizePhone("6175551")).toBeNull(); // bare, too short
    expect(normalizePhone("61755513456789")).toBeNull(); // bare, too long
  });
});

describe("validateProfile — phone (N35)", () => {
  it("accepts anything normalizePhone can canonicalize; flags what it can't", () => {
    expect(fields({ phone: "(617) 555-1234" })).toEqual([]);
    expect(fields({ phone: "+44 20 7123 4567" })).toEqual([]);
    expect(fields({ phone: "letters" })).toEqual(["phone"]);
    expect(fields({ phone: "12345" })).toEqual(["phone"]);
  });
});

describe("validateProfile — big brother", () => {
  it("rejects a brother set as their own Big Brother", () => {
    expect(fields({ id: 5247, bigBrotherId: 5247 })).toEqual(["bigBrotherId"]);
  });
  it("accepts a different Big Brother id", () => {
    expect(fields({ id: 5247, bigBrotherId: 5001 })).toEqual([]);
  });
});

describe("validateProfile — deceased lifespan (D122)", () => {
  it("rejects deathYear together with a full date of death (mutually exclusive)", () => {
    expect(
      fields({ deceased: { isDeceased: true, dateOfDeath: "2020-05-01", deathYear: 2020 } }),
    ).toEqual(["deceased.deathYear"]);
  });
  it("accepts a year-only death", () => {
    expect(fields({ deceased: { isDeceased: true, deathYear: 2020 } })).toEqual([]);
  });
  it("rejects birth/death years on a living record", () => {
    expect(fields({ deceased: { isDeceased: false, birthYear: 1960 } })).toEqual([
      "deceased.birthYear",
    ]);
  });
  it("rejects a death year before the birth year", () => {
    expect(fields({ deceased: { isDeceased: true, birthYear: 1990, deathYear: 1980 } })).toEqual([
      "deceased.deathYear",
    ]);
  });
  it("rejects an implausibly low year-only death year (has a floor now — OFC-96)", () => {
    expect(fields({ deceased: { isDeceased: true, deathYear: 200 } })).toEqual([
      "deceased.deathYear",
    ]);
    expect(fields({ deceased: { isDeceased: true, deathYear: 1500 } })).toEqual([
      "deceased.deathYear",
    ]);
    // A plausible year-only death (no birthYear to compare) still passes.
    expect(fields({ deceased: { isDeceased: true, deathYear: 1975 } })).toEqual([]);
  });
  it("rejects a bad date of death", () => {
    expect(fields({ deceased: { isDeceased: true, dateOfDeath: "2020-02-31" } })).toEqual([
      "deceased.dateOfDeath",
    ]);
  });
});

describe("validateProfile — consent & privacy (OFC-111)", () => {
  it("accepts valid consent booleans and a well-formed privacy object", () => {
    expect(
      fields({
        allowNewsletterEmail: true,
        unlisted: false,
        privacy: {
          shareEmail: true,
          sharePhone: false,
          shareAddress: true,
          shareEmergency: false,
          shareSpousePartner: false,
        },
      }),
    ).toEqual([]);
  });

  it("rejects a non-boolean consent flag", () => {
    expect(fields({ unlisted: "no" as unknown as boolean })).toEqual(["unlisted"]);
    expect(fields({ allowShareWithMITAA: 1 as unknown as boolean })).toEqual([
      "allowShareWithMITAA",
    ]);
  });

  it("rejects a privacy value that isn't an object", () => {
    expect(fields({ privacy: "nope" as unknown as Profile["privacy"] })).toEqual(["privacy"]);
    expect(fields({ privacy: null as unknown as Profile["privacy"] })).toEqual(["privacy"]);
  });

  it("rejects a non-boolean switch inside the privacy object", () => {
    expect(fields({ privacy: { shareEmail: "yes" } as unknown as Profile["privacy"] })).toEqual([
      "privacy.shareEmail",
    ]);
  });
});
