import { describe, expect, it } from "vitest";
import { scrub } from "./scrub.js";

describe("scrub (P10 PII redaction for the diagnostic stream)", () => {
  it("redacts an email echoed by an upstream Ghost error — the real vector", () => {
    // The Ghost Admin API commonly names the queried member email in its error.
    const message = "ghost: a member already exists with email james@example.com";
    const out = scrub(message);
    expect(out).not.toContain("james@example.com");
    expect(out).not.toContain("@");
    expect(out).toContain("[email]");
    // The non-PII part of the message survives.
    expect(out).toContain("a member already exists");
  });

  it("redacts a bare email and every email in a multi-email string", () => {
    expect(scrub("a@b.com")).toBe("[email]");
    const out = scrub("merge conflict between old@pbe.org and new@mit.edu");
    expect(out).not.toContain("@");
    expect(out).toBe("merge conflict between [email] and [email]");
  });

  it("redacts a formatted (NANP) phone number", () => {
    for (const phone of ["(617) 555-1234", "617-555-1234", "+1 617 555 1234"]) {
      const out = scrub(`emergency contact ${phone} unreachable`);
      expect(out).not.toContain("555");
      expect(out).toContain("[phone]");
    }
  });

  it("redacts an E.164 phone number", () => {
    const out = scrub("sms gateway rejected +16175551234");
    expect(out).not.toContain("6175551234");
    expect(out).toContain("[phone]");
  });

  it("leaves a bare Constitution ID intact — an ID is not PII (the acknowledged edge)", () => {
    // IDs ride the logger's structured slots, but even inline a 4-digit id is far
    // too short to be a phone number, so the scrubber never mistakes it for one.
    const out = scrub("hydration dropped malformed profile 5247");
    expect(out).toBe("hydration dropped malformed profile 5247");
  });

  it("leaves an ISO timestamp intact — a date is not a phone number", () => {
    // The NANP 3-3-4 shape deliberately does not match `YYYY-MM-DD`.
    const out = scrub("newsletter change at 2026-07-21 unavailable");
    expect(out).toBe("newsletter change at 2026-07-21 unavailable");
  });

  it("passes a constant, PII-free message through unchanged (the common case)", () => {
    const message = "session revocation failed; falling back to the 4-hour session cap";
    expect(scrub(message)).toBe(message);
  });

  it("is idempotent", () => {
    const once = scrub("contact james@example.com or (617) 555-1234");
    expect(scrub(once)).toBe(once);
  });

  it("stays linear on a long adversarial input (no ReDoS — N88)", () => {
    // A pathological string that a backtracking pattern would choke on. This must
    // return effectively instantly; a superlinear regex would hang the run.
    const evil = `${"a".repeat(50_000)}@`;
    const start = process.hrtime.bigint();
    scrub(evil);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(100);
  });
});
