import { describe, expect, it } from "vitest";
import type { ProfileRecord } from "../../lib/types.js";
import { buildPatch, isDirty, valuesEqual } from "./patch.js";

/** A minimal owner record to diff against (only the fields the tests touch). */
function record(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: 5247,
    firstName: "James",
    lastName: "Smyth",
    classYear: 1984,
    email: "james@example.test",
    privacy: {
      shareEmail: true,
      sharePhone: true,
      shareAddress: true,
      shareEmergency: false,
      shareSpousePartner: false,
    },
    unlisted: false,
    allowNewsletterEmail: true,
    ...overrides,
  };
}

describe("valuesEqual", () => {
  it("treats structurally identical nested values as equal", () => {
    expect(valuesEqual({ a: [1, 2], b: { c: 3 } }, { a: [1, 2], b: { c: 3 } })).toBe(true);
  });
  it("detects a single nested change", () => {
    expect(valuesEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
  });
  it("distinguishes null from object and arrays of different length", () => {
    expect(valuesEqual(null, {})).toBe(false);
    expect(valuesEqual([1], [1, 2])).toBe(false);
  });
});

describe("buildPatch", () => {
  it("includes only the fields that changed", () => {
    const original = record();
    const draft = record({ firstName: "Jim" });
    expect(buildPatch(original, draft, "brother", true)).toEqual({ firstName: "Jim" });
  });

  it("returns an empty patch when nothing changed", () => {
    const original = record();
    const draft = record();
    expect(buildPatch(original, draft, "brother", true)).toEqual({});
  });

  it("diffs a nested privacy flag and sends the whole object", () => {
    const original = record();
    const draft = record({
      privacy: { ...record().privacy, shareEmail: false } as ProfileRecord["privacy"],
    });
    const patch = buildPatch(original, draft, "brother", true);
    expect(patch.privacy?.shareEmail).toBe(false);
  });

  it("drops a consent change a manager-on-another may not write", () => {
    const original = record();
    // A manager flips someone else's consent and edits a directory field.
    const draft = record({ employerName: "Akamai", unlisted: true });
    const patch = buildPatch(original, draft, "manager", false);
    expect(patch).toEqual({ employerName: "Akamai" });
    expect(patch.unlisted).toBeUndefined();
  });

  it("never includes the immutable id or a protected field", () => {
    const original = record({ lastModified: "2026-01-01T00:00:00.000Z" });
    const draft = record({ id: 9999, lastModified: "2026-06-29T00:00:00.000Z" } as ProfileRecord);
    expect(buildPatch(original, draft, "admin", false)).toEqual({});
  });

  it("encodes clearing a field as an explicit null that survives JSON (OFC-107)", () => {
    const original = record({ email: "james@example.test" });
    const draft = record({ email: undefined });
    const patch = buildPatch(original, draft, "brother", true);
    // The clear is a null sentinel, not `undefined` — so it is NOT dropped when
    // the request body is serialized (the gap the old `undefined` had).
    expect(patch).toHaveProperty("email", null);
    const roundTripped = JSON.parse(JSON.stringify(patch));
    expect(roundTripped).toHaveProperty("email", null);
    expect("email" in roundTripped).toBe(true);
  });

  it("clears an emptied address / majors / links via the null sentinel (OFC-107)", () => {
    const original = record({
      address: { city: "Cambridge", country: "US" },
      majors: ["6-3"],
    } as Partial<ProfileRecord>);
    const draft = record({ address: undefined, majors: undefined } as Partial<ProfileRecord>);
    const patch = buildPatch(original, draft, "brother", true);
    expect(patch).toHaveProperty("address", null);
    expect(patch).toHaveProperty("majors", null);
  });

  it("sends a genuine null value (bigBrotherId cleared to none) as null, not dropped", () => {
    const original = record({ bigBrotherId: 5100 } as Partial<ProfileRecord>);
    const draft = record({ bigBrotherId: null } as Partial<ProfileRecord>);
    const patch = buildPatch(original, draft, "brother", true);
    expect(patch).toHaveProperty("bigBrotherId", null);
  });
});

describe("isDirty", () => {
  it("is false for an untouched draft and true after an editable change", () => {
    const original = record();
    expect(isDirty(original, record(), "brother", true)).toBe(false);
    expect(isDirty(original, record({ phone: "617-555-0142" }), "brother", true)).toBe(true);
  });

  it("ignores a change a manager-on-another cannot write", () => {
    const original = record();
    const draft = record({ allowNewsletterEmail: false });
    expect(isDirty(original, draft, "manager", false)).toBe(false);
  });
});
