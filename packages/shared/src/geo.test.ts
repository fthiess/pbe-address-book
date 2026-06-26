import { describe, expect, it } from "vitest";
import {
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
