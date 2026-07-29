import { getHelpEntry } from "@pbe/help-content";
import { describe, expect, it } from "vitest";
import { CLASS_YEAR_HELPER, classYearErrorText, parseClassYearInput } from "./class-year.js";

describe("parseClassYearInput", () => {
  it("maps a blank box to null — class year is optional (OFC-365)", () => {
    expect(parseClassYearInput("")).toBeNull();
    expect(parseClassYearInput("   ")).toBeNull();
  });

  it("maps the typed word “unknown” to null, in any casing", () => {
    expect(parseClassYearInput("unknown")).toBeNull();
    expect(parseClassYearInput("Unknown")).toBeNull();
    expect(parseClassYearInput("  UNKNOWN  ")).toBeNull();
  });

  it("parses a year, tolerating surrounding whitespace", () => {
    expect(parseClassYearInput("1984")).toBe(1984);
    expect(parseClassYearInput("  2001 ")).toBe(2001);
  });

  it("returns NaN for anything that is not a whole number", () => {
    expect(parseClassYearInput("abcd")).toBeNaN();
    expect(parseClassYearInput("19x4")).toBeNaN();
    expect(parseClassYearInput("2001.5")).toBeNaN();
  });

  it("does not treat an out-of-range year as unparseable — the validator judges range", () => {
    expect(parseClassYearInput("84")).toBe(84);
    expect(parseClassYearInput("1850")).toBe(1850);
  });
});

describe("CLASS_YEAR_HELPER", () => {
  it("is the registry's helper text, which USER-MANUAL.md is drift-checked against", () => {
    expect(CLASS_YEAR_HELPER).toBe(getHelpEntry("profile.classYear")?.helperText);
    expect(CLASS_YEAR_HELPER).not.toBe("");
  });
});

describe("classYearErrorText", () => {
  const shape = "Class year must be a 4-digit year or unknown.";
  const range = "Class year must be between 1890 and 2032.";

  it("shows nothing when the field is valid", () => {
    expect(classYearErrorText("1984", undefined)).toBeUndefined();
    expect(classYearErrorText("", undefined)).toBeUndefined();
  });

  it("replaces a malformed entry's complaint with the helper text — only the colour changes", () => {
    expect(classYearErrorText("abcd", shape)).toBe(CLASS_YEAR_HELPER);
  });

  it("keeps the range message for a well-formed year outside the range", () => {
    expect(classYearErrorText("1850", range)).toBe(range);
    expect(classYearErrorText("2199", range)).toBe(range);
  });

  it("keeps a range message for a short year, which is still a whole number", () => {
    expect(classYearErrorText("84", range)).toBe(range);
  });
});
