import { describe, expect, it } from "vitest";
import { normalizeToken, tokenize } from "./tokenize.js";

describe("tokenize", () => {
  it("splits on whitespace and hyphens (D35)", () => {
    expect(tokenize("Smith-Jones")).toEqual(["smith", "jones"]);
    expect(tokenize("Hilbert Space Pilot")).toEqual(["hilbert", "space", "pilot"]);
    expect(tokenize("Jean-Luc  Picard")).toEqual(["jean", "luc", "picard"]);
  });

  it("folds case and diacritics so accented and plain forms tokenize alike", () => {
    expect(tokenize("José García")).toEqual(["jose", "garcia"]);
    expect(tokenize("Renée")).toEqual(tokenize("Renee"));
  });

  it("drops number-only tokens (class year, Constitution ID) and punctuation", () => {
    // The Canonical Name carries a year and possibly an ID — neither is a name.
    expect(tokenize("William Smyth '84 (#5247)")).toEqual(["william", "smyth"]);
    expect(tokenize("O'Brien")).toEqual(["obrien"]);
  });

  it("returns an empty list for empty, null, or undefined input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  it("normalizeToken folds a single word and strips surrounding punctuation", () => {
    expect(normalizeToken("MÜLLER")).toBe("muller");
    expect(normalizeToken("d'Angelo")).toBe("dangelo");
  });
});
