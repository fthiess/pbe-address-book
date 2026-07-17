import type { Profile } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import type { ProfileRecord } from "../../lib/types.js";
import { buildPatch, isDirty, valuesEqual, wouldClearUsableEmail } from "./patch.js";

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

  it("drops a toggle field a manager cannot see on this record (OFC-206/N70)", () => {
    // shareSpousePartner is off on the record, so the manager never received the
    // value — the diff must drop it even though the empty draft field "changed",
    // so a stray keystroke never blind-overwrites hidden data.
    const original = record();
    const draft = record({ employerName: "Akamai", spousePartnerName: "Blind Overwrite" });
    const patch = buildPatch(original, draft, "manager", false);
    expect(patch).toEqual({ employerName: "Akamai" });
    expect(patch.spousePartnerName).toBeUndefined();
  });

  it("keeps a toggle field the owner has shared, for a manager (OFC-206/N70)", () => {
    const shared = { ...record().privacy, shareSpousePartner: true } as ProfileRecord["privacy"];
    const original = record({ privacy: shared });
    const draft = record({ privacy: shared, spousePartnerName: "Pat Smyth" });
    const patch = buildPatch(original, draft, "manager", false);
    expect(patch.spousePartnerName).toBe("Pat Smyth");
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

describe("wouldClearUsableEmail (OFC-272 guard predicate)", () => {
  it("fires when a set email is cleared (the null-sentinel patch a real Save sends)", () => {
    const original = record({ email: "james@example.test" });
    const patch = buildPatch(original, record({ email: undefined }), "brother", true);
    // Sanity: this is exactly the cleared-email patch buildPatch produces.
    expect(patch).toHaveProperty("email", null);
    expect(wouldClearUsableEmail(original, patch)).toBe(true);
  });

  it("fires when the email is replaced by a whitespace-only value (not sign-in usable)", () => {
    const original = record({ email: "james@example.test" });
    expect(wouldClearUsableEmail(original, { email: "   " } as Partial<Profile>)).toBe(true);
  });

  it("does NOT fire when the email is changed to a different usable address", () => {
    const original = record({ email: "james@example.test" });
    const patch = buildPatch(original, record({ email: "jim@example.test" }), "brother", true);
    expect(patch).toHaveProperty("email", "jim@example.test");
    expect(wouldClearUsableEmail(original, patch)).toBe(false);
  });

  it("does NOT fire when the record never had a usable email (nothing to lose)", () => {
    const original = record({ email: undefined });
    // Even a patch that explicitly clears email can't lock out someone already email-less.
    expect(wouldClearUsableEmail(original, { email: null } as unknown as Partial<Profile>)).toBe(
      false,
    );
  });

  it("does NOT fire when email is untouched and only another field changed", () => {
    const original = record({ email: "james@example.test" });
    const patch = buildPatch(original, record({ phone: "617-555-0142" }), "brother", true);
    expect("email" in patch).toBe(false);
    expect(wouldClearUsableEmail(original, patch)).toBe(false);
  });

  it("does NOT fire on the redacted private-email projection (original email absent)", () => {
    // A manager without shareEmail never received the value, so the projected record
    // carries no email; the field isn't even editable for them. The guard must not
    // trip off a phantom clear.
    const original = record({ email: undefined });
    expect(wouldClearUsableEmail(original, { email: null } as unknown as Partial<Profile>)).toBe(
      false,
    );
  });

  it("does NOT fire for an empty patch (a photo-only or no-op Save)", () => {
    expect(wouldClearUsableEmail(record(), {})).toBe(false);
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
