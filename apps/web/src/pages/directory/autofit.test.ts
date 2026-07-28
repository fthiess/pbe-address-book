import { describe, expect, it } from "vitest";
import { autoFitChipStripWidth, autoFitWidth, chipStripWidth, gridCellFont } from "./autofit.js";

/** A deterministic measurer: width = characters × 10px, so assertions are exact. */
const measure = (text: string) => text.length * 10;

/** Cells with no search running — the common case, no highlight marks. */
const plain = (...texts: string[]) => texts.map((text) => ({ text }));

describe("autoFitWidth (N27)", () => {
  it("fits to the widest data value plus cell padding", () => {
    // widest value "Wolfeschlegelstein" (18) × 10 = 180, + 24 padding = 204.
    const width = autoFitWidth("X", plain("Al", "Wolfeschlegelstein", "Bo"), measure);
    expect(width).toBe(204);
  });

  it("never clips the header label (header chrome included)", () => {
    // Data is tiny; the header "Constitution ID" (15) × 10 + 64 chrome = 214 wins.
    const width = autoFitWidth("Constitution ID", plain("1"), measure);
    expect(width).toBe(214);
  });

  it("clamps to the 64–640 bounds", () => {
    expect(autoFitWidth("", [], measure)).toBe(64); // nothing to measure → min
    const huge = "x".repeat(200);
    expect(autoFitWidth("", plain(huge), measure)).toBe(640); // 2024 → clamped to max
  });

  it("allows for each highlight mark's padding (OFC-358)", () => {
    // "Adamson" (7) × 10 = 70, + 24 padding = 94 unmarked; two marks add 2px each.
    expect(autoFitWidth("X", plain("Adamson"), measure)).toBe(94);
    expect(autoFitWidth("X", [{ text: "Adamson", marks: 2 }], measure)).toBe(98);
  });

  it("fits what a cell renders, not merely what its text measures (OFC-358)", () => {
    // Same two names, one of them carrying three marks: the fitted column has to
    // grow by exactly that cell's mark padding, or the highlighted name clips.
    const marked = autoFitWidth("X", [{ text: "Adams", marks: 3 }, { text: "Brown" }], measure);
    expect(marked).toBe(autoFitWidth("X", plain("Adams", "Brown"), measure) + 6);
  });
});

describe("gridCellFont (OFC-358)", () => {
  it("measures the Name column at the weight its link renders (font-medium)", () => {
    // Node has no getComputedStyle, so this exercises the fallback stack — the
    // weight is the part under test either way.
    expect(gridCellFont("name")).toBe("500 14px sans-serif");
  });

  it("measures every other column at the body weight", () => {
    expect(gridCellFont("email")).toBe("14px sans-serif");
    expect(gridCellFont()).toBe("14px sans-serif");
  });
});

describe("chipStripWidth (Course chips — OFC-269/OFC-277)", () => {
  it("is a single chip's code plus its pill chrome", () => {
    // "6-3" (3) × 10 = 30, + 20 chip padding = 50; no gaps for one chip.
    expect(chipStripWidth(["6-3"], measure)).toBe(50);
  });

  it("sums every chip and the gaps between them", () => {
    // Three chips 6-3/18/14-1: (30+20) + (20+20) + (40+20) + 2 gaps × 4 = 158.
    expect(chipStripWidth(["6-3", "18", "14-1"], measure)).toBe(158);
  });

  it("contributes nothing for a brother with no courses", () => {
    expect(chipStripWidth([], measure)).toBe(0);
  });
});

describe("autoFitChipStripWidth (Course column auto-fit — OFC-277)", () => {
  it("fits the widest full chip strip across the display set, plus cell padding", () => {
    // Widest strip is the 3-course brother (158 from above), + 24 cell padding = 182.
    const width = autoFitChipStripWidth("Course", [["6-3"], ["6-3", "18", "14-1"], []], measure);
    expect(width).toBe(182);
  });

  it("sizes to show ALL courses, not just the primary (the OFC-277 regression)", () => {
    // The bug: the column was fitted to the primary course alone, cutting off the
    // rest. A brother with several courses must fit wider than his primary alone.
    const allCourses = autoFitChipStripWidth("Course", [["6-3", "18", "14-1"]], measure);
    const primaryOnly = autoFitChipStripWidth("Course", [["6-3"]], measure);
    expect(allCourses).toBeGreaterThan(primaryOnly);
  });

  it("still fits the header when every brother's courses are narrow", () => {
    // Tiny data; the header "Course" (6) × 10 + 64 chrome = 124 wins.
    expect(autoFitChipStripWidth("Course", [["6"]], measure)).toBe(124);
  });
});
