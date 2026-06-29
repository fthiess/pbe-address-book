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

  it("treats clearing a field (→ undefined) as a change", () => {
    const original = record({ email: "james@example.test" });
    const draft = record({ email: undefined });
    expect(buildPatch(original, draft, "brother", true)).toHaveProperty("email", undefined);
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
