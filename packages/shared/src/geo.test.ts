import { describe, expect, it } from "vitest";
import {
  countryName,
  hasControlledSubdivisions,
  isCountryCode,
  isSubdivisionCode,
  subdivisionName,
} from "./geo.js";

describe("isCountryCode", () => {
  it("accepts valid ISO 3166-1 alpha-2 codes, case-insensitively", () => {
    expect(isCountryCode("US")).toBe(true);
    expect(isCountryCode("gb")).toBe(true);
    expect(isCountryCode(" TW ")).toBe(true);
    expect(isCountryCode("DE")).toBe(true);
  });

  it("rejects non-codes", () => {
    expect(isCountryCode("USA")).toBe(false);
    expect(isCountryCode("ZZ")).toBe(false);
    expect(isCountryCode("")).toBe(false);
  });

  it("rejects non-string input without throwing (OFC-89 hardening)", () => {
    expect(isCountryCode(null as unknown as string)).toBe(false);
    expect(isCountryCode(123 as unknown as string)).toBe(false);
    expect(isSubdivisionCode("US", null as unknown as string)).toBe(false);
  });
});

describe("countryName", () => {
  it("derives an English display name for a valid code", () => {
    expect(countryName("US")).toMatch(/United States/);
    expect(countryName("gb")).toMatch(/United Kingdom/);
  });

  it("falls back to the raw code on input Intl.DisplayNames throws on (OFC-95)", () => {
    // "USA", "England", and "" all make Intl.DisplayNames.of throw a RangeError,
    // which the old `?? upper` fallback did not catch — the render must not crash.
    expect(countryName("USA")).toBe("USA");
    expect(countryName("England")).toBe("ENGLAND");
    expect(countryName("")).toBe("");
  });
});

describe("subdivisions", () => {
  it("flags US and CA as controlled-vocabulary countries", () => {
    expect(hasControlledSubdivisions("US")).toBe(true);
    expect(hasControlledSubdivisions("ca")).toBe(true);
    expect(hasControlledSubdivisions("GB")).toBe(false);
    expect(hasControlledSubdivisions(undefined)).toBe(false);
  });

  it("validates US codes including DC and the military codes (§8)", () => {
    expect(isSubdivisionCode("US", "MA")).toBe(true);
    expect(isSubdivisionCode("US", "DC")).toBe(true);
    expect(isSubdivisionCode("US", "AE")).toBe(true);
    expect(isSubdivisionCode("US", "ZZ")).toBe(false);
  });

  it("validates Canadian provinces and territories", () => {
    expect(isSubdivisionCode("CA", "ON")).toBe(true);
    expect(isSubdivisionCode("CA", "QC")).toBe(true);
    expect(isSubdivisionCode("CA", "XX")).toBe(false);
  });

  it("treats any non-US/CA subdivision as free text (always valid)", () => {
    expect(isSubdivisionCode("GB", "Greater London")).toBe(true);
    expect(isSubdivisionCode(undefined, "anything")).toBe(true);
  });

  it("derives display names for US/CA and echoes free text otherwise", () => {
    expect(subdivisionName("US", "MA")).toBe("Massachusetts");
    expect(subdivisionName("CA", "BC")).toBe("British Columbia");
    expect(subdivisionName("GB", "Kent")).toBe("Kent");
  });
});
