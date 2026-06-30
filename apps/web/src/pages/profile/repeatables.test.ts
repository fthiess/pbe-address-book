import { describe, expect, it } from "vitest";
import type { ProfileRecord } from "../../lib/types.js";
import { isBlankContact, isBlankLink, sanitizeRepeatables } from "./repeatables.js";

const base: ProfileRecord = { id: 5247 };

describe("isBlankLink", () => {
  it("treats an all-empty link as blank", () => {
    expect(isBlankLink({ label: "", url: "" })).toBe(true);
    expect(isBlankLink({ label: "   ", url: "  " })).toBe(true);
  });

  it("treats a partly-filled link as not blank", () => {
    expect(isBlankLink({ label: "LinkedIn", url: "" })).toBe(false);
    expect(isBlankLink({ label: "", url: "https://x.test" })).toBe(false);
  });
});

describe("isBlankContact", () => {
  it("is blank only when name, phone, and email are all empty", () => {
    expect(isBlankContact({ name: "", phone: "", email: "" })).toBe(true);
    expect(isBlankContact({})).toBe(true);
    expect(isBlankContact({ phone: "555-1212" })).toBe(false);
  });
});

describe("sanitizeRepeatables", () => {
  it("drops a trailing blank link row and keeps the filled ones", () => {
    const draft: ProfileRecord = {
      ...base,
      links: [
        { label: "Site", url: "https://x.test" },
        { label: "", url: "" },
      ],
    };
    expect(sanitizeRepeatables(draft).links).toEqual([{ label: "Site", url: "https://x.test" }]);
  });

  it("clears the field entirely when only a blank row remains", () => {
    const draft: ProfileRecord = { ...base, links: [{ label: "", url: "" }] };
    expect(sanitizeRepeatables(draft).links).toBeUndefined();
  });

  it("keeps a partly-filled link so it can be validated (label, no URL)", () => {
    const draft: ProfileRecord = { ...base, links: [{ label: "LinkedIn", url: "" }] };
    expect(sanitizeRepeatables(draft).links).toEqual([{ label: "LinkedIn", url: "" }]);
  });

  it("drops a blank emergency-contact row but keeps a contact with any field", () => {
    const draft: ProfileRecord = {
      ...base,
      emergencyContacts: [
        { name: "Pat", phone: "", email: "" },
        { name: "", phone: "", email: "" },
      ],
    };
    expect(sanitizeRepeatables(draft).emergencyContacts).toEqual([
      { name: "Pat", phone: "", email: "" },
    ]);
  });

  it("returns the same reference when there is nothing to drop", () => {
    const draft: ProfileRecord = { ...base, links: [{ label: "Site", url: "https://x.test" }] };
    expect(sanitizeRepeatables(draft)).toBe(draft);
  });
});
