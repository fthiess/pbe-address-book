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

  it("folds atomic Latin letters that NFKD does not decompose (OFC-200)", () => {
    // ø/æ/œ/ß/ł are single code points — not letter + combining mark — so NFKD
    // leaves them intact and the combining-mark strip can't reach them. They need
    // an explicit fold, or "Søren" tokenizes to "søren" and a search for "sor"
    // (or "soren") never finds him. D35 promises accent-insensitive search.
    expect(tokenize("Søren")).toEqual(["soren"]);
    expect(tokenize("Kjærgaard")).toEqual(["kjaergaard"]);
    expect(tokenize("Œuvre")).toEqual(["oeuvre"]);
    expect(normalizeToken("Straße")).toBe("strasse");
    expect(normalizeToken("Łukasz")).toBe("lukasz");
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
