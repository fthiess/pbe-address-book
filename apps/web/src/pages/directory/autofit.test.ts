import { describe, expect, it } from "vitest";
import { autoFitWidth } from "./autofit.js";

/** A deterministic measurer: width = characters × 10px, so assertions are exact. */
const measure = (text: string) => text.length * 10;

describe("autoFitWidth (N27)", () => {
  it("fits to the widest data value plus cell padding", () => {
    // widest value "Wolfeschlegelstein" (18) × 10 = 180, + 24 padding = 204.
    const width = autoFitWidth("X", ["Al", "Wolfeschlegelstein", "Bo"], measure);
    expect(width).toBe(204);
  });

  it("never clips the header label (header chrome included)", () => {
    // Data is tiny; the header "Constitution ID" (15) × 10 + 64 chrome = 214 wins.
    const width = autoFitWidth("Constitution ID", ["1"], measure);
    expect(width).toBe(214);
  });

  it("clamps to the 64–640 bounds", () => {
    expect(autoFitWidth("", [], measure)).toBe(64); // nothing to measure → min
    const huge = "x".repeat(200);
    expect(autoFitWidth("", [huge], measure)).toBe(640); // 2024 → clamped to max
  });

  it("adds per-value chrome for non-plain-text cells (the Course chip)", () => {
    const plain = autoFitWidth("", ["6-3"], measure); // 30 + 24 = 54 → min 64
    const chip = autoFitWidth("", ["6-3"], measure, 20); // 30 + 20 + 24 = 74
    expect(plain).toBe(64);
    expect(chip).toBe(74);
  });
});
