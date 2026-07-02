import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { decodeToken, encodeToken } from "./profiles.js";

describe("decodeToken / encodeToken (OFC-90)", () => {
  it("round-trips a well-formed token", () => {
    const decoded = decodeToken("1719400000.123");
    expect(decoded).toBeInstanceOf(Timestamp);
    expect(decoded && encodeToken(decoded)).toBe("1719400000.123");
  });

  it("accepts the initial `0.0` seed token", () => {
    expect(decodeToken("0.0")).toBeInstanceOf(Timestamp);
  });

  it("returns null for a malformed token rather than a NaN Timestamp", () => {
    // Any opaque `If-Match` — a bare word, a quoted tag, `*`, or a partial — must
    // decode to null so the store maps it to a 412, not a 500 (OFC-90).
    for (const bad of [
      "abc",
      '"1719400000.123"',
      "*",
      "1719400000",
      ".",
      "1.",
      ".2",
      "1.2.3",
      "",
    ]) {
      expect(decodeToken(bad), `expected ${bad} to be rejected`).toBeNull();
    }
  });
});
