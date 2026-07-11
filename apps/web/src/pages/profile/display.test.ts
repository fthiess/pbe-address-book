import { describe, expect, it } from "vitest";
import { verifierAttribution } from "./display.js";

describe("verifierAttribution (OFC-208)", () => {
  const names = new Map<number, string>([
    [5001, "Robert Brown '79"],
    [5247, "James Smyth '84"],
  ]);

  it("reads '(self)' when the brother confirmed his own record", () => {
    expect(verifierAttribution(5247, 5247, names)).toBe(" (self)");
  });

  it("names the verifier when the roster resolves him", () => {
    expect(verifierAttribution(5247, 5001, names)).toBe(" by Robert Brown '79");
  });

  it("falls back to no attribution when the verifier is not in the roster (hidden from a brother)", () => {
    // A manager/admin verifier who is unlisted/de-brothered is absent from a
    // brother's roster; the line degrades to a bare date rather than leaking him.
    expect(verifierAttribution(5247, 5999, names)).toBe("");
    expect(verifierAttribution(5247, 5001, null)).toBe("");
  });

  it("has no attribution for a legacy stamp missing verifiedBy", () => {
    expect(verifierAttribution(5247, undefined, names)).toBe("");
  });

  it("prefers '(self)' over a name lookup even if the id is also in the roster", () => {
    expect(verifierAttribution(5001, 5001, names)).toBe(" (self)");
  });
});
