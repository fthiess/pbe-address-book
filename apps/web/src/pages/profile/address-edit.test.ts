import type { Address } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { applyCountryChange, isBlankAddress } from "./address-edit.js";

describe("applyCountryChange", () => {
  it("clears a US state when switching to Canada (vocabulary can't hold it)", () => {
    const { next, cleared } = applyCountryChange({ country: "US", stateProvince: "MA" }, "CA");
    expect(cleared).toBe(true);
    expect(next.stateProvince).toBeUndefined();
    expect(next.country).toBe("CA");
  });

  it("keeps the value as free text when switching to a country with no controlled vocabulary", () => {
    // GB has no controlled subdivisions, so the prior value becomes free text (not cleared).
    const { next, cleared } = applyCountryChange({ country: "US", stateProvince: "CA" }, "GB");
    expect(cleared).toBe(false);
    expect(next.stateProvince).toBe("CA");
  });

  it("keeps a valid subdivision under the new country", () => {
    const { next, cleared } = applyCountryChange({ country: "CA", stateProvince: "ON" }, "CA");
    expect(cleared).toBe(false);
    expect(next.stateProvince).toBe("ON");
  });

  it("keeps free text when moving between free-text countries", () => {
    const { next, cleared } = applyCountryChange({ country: "GB", stateProvince: "Devon" }, "FR");
    expect(cleared).toBe(false);
    expect(next.stateProvince).toBe("Devon");
  });

  it("handles an undefined address", () => {
    const { next, cleared } = applyCountryChange(undefined, "US");
    expect(cleared).toBe(false);
    expect(next).toEqual({ country: "US" });
  });
});

describe("isBlankAddress", () => {
  it("is blank for undefined and all-empty", () => {
    expect(isBlankAddress(undefined)).toBe(true);
    expect(isBlankAddress({ street1: "", city: "  ", country: "" })).toBe(true);
  });

  it("is not blank when any field has a value", () => {
    expect(isBlankAddress({ city: "Cambridge" } as Address)).toBe(false);
  });
});
