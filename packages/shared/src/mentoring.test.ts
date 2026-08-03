import { describe, expect, it } from "vitest";
import { isWillingToMentor } from "./mentoring.js";

describe("isWillingToMentor (D166)", () => {
  it("is true only for a living brother who opted in", () => {
    expect(isWillingToMentor({ willingToMentor: true, deceased: { isDeceased: false } })).toBe(
      true,
    );
  });

  it("is false for a living brother who has not opted in", () => {
    expect(isWillingToMentor({ willingToMentor: false, deceased: { isDeceased: false } })).toBe(
      false,
    );
  });

  it("is false for a DECEASED brother who had opted in — the case the predicate exists for", () => {
    // His stored answer is deliberately left true (see the module note); what must
    // not happen is presenting it as a live offer on his memorial profile, or
    // returning him from a search for available mentors with "Include deceased" on.
    expect(isWillingToMentor({ willingToMentor: true, deceased: { isDeceased: true } })).toBe(
      false,
    );
  });

  it("treats an absent field as not willing (a record predating the field)", () => {
    expect(isWillingToMentor({})).toBe(false);
    expect(isWillingToMentor({ deceased: { isDeceased: false } })).toBe(false);
  });

  it("treats an absent deceased block as living, not as a reason to withhold", () => {
    // The projected wire shape omits absent fields, so a record can legitimately
    // arrive with no `deceased` block; that must not silently suppress a live opt-in.
    expect(isWillingToMentor({ willingToMentor: true })).toBe(true);
  });
});
