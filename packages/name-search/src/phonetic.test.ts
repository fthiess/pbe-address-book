import { describe, expect, it } from "vitest";
import { phoneticCodes } from "./phonetic.js";

describe("phoneticCodes (D35/D66)", () => {
  it("Double Metaphone gives sound-alikes the same code (Smith ≈ Smyth)", () => {
    const smith = new Set(phoneticCodes("smith", "double-metaphone"));
    const smyth = phoneticCodes("smyth", "double-metaphone");
    expect(smyth.some((code) => smith.has(code))).toBe(true);
  });

  it("Beider-Morse gives sound-alikes overlapping codes", () => {
    const katz = new Set(phoneticCodes("katz", "beider-morse"));
    const cats = phoneticCodes("cats", "beider-morse");
    expect(cats.some((code) => katz.has(code))).toBe(true);
  });

  it("Beider-Morse produces many more encodings than Double Metaphone (recall arm)", () => {
    // The recall/precision trade-off the A/B harness measures (D66): BM's broad
    // encoding set is exactly why it catches more international variants.
    const dm = phoneticCodes("alexander", "double-metaphone");
    const bm = phoneticCodes("alexander", "beider-morse");
    expect(dm.length).toBeLessThanOrEqual(2);
    expect(bm.length).toBeGreaterThan(dm.length);
  });

  it("returns no codes for the 'none' algorithm or an empty token", () => {
    expect(phoneticCodes("smith", "none")).toEqual([]);
    expect(phoneticCodes("", "double-metaphone")).toEqual([]);
    expect(phoneticCodes("", "beider-morse")).toEqual([]);
  });
});
