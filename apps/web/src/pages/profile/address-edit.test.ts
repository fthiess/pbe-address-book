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

  it("clears a stranded controlled code when leaving US/CA for a free-text country", () => {
    // A US code carries no meaning under the UK, so it must not survive as bare "CA".
    const { next, cleared } = applyCountryChange({ country: "US", stateProvince: "CA" }, "GB");
    expect(cleared).toBe(true);
    expect(next.stateProvince).toBeUndefined();
  });

  it("clears a free-text region that isn't a code under a newly-controlled country", () => {
    const { next, cleared } = applyCountryChange({ country: "GB", stateProvince: "Devon" }, "US");
    expect(cleared).toBe(true);
    expect(next.stateProvince).toBeUndefined();
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

  it("clears a controlled code stranded under an undefined stored country (OFC-113)", () => {
    // Legacy record: stateProvince "MA" (a US code) but no stored country. The
    // editor displays it as US, so switching to a free-text country must clear it —
    // the effective old country is resolved as US, not left as `undefined`.
    const { next, cleared } = applyCountryChange({ stateProvince: "MA" }, "GB");
    expect(cleared).toBe(true);
    expect(next.stateProvince).toBeUndefined();
    expect(next.country).toBe("GB");
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
