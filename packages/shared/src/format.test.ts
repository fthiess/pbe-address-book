import { describe, expect, it } from "vitest";
import { formatClassYear, formatConstitutionId } from "./format.js";

describe("formatConstitutionId", () => {
  it("prefixes the id with a hash", () => {
    expect(formatConstitutionId(5247)).toBe("#5247");
  });
});

describe("formatClassYear", () => {
  it("renders the conventional apostrophe-two-digit form", () => {
    expect(formatClassYear(1984)).toBe("'84");
  });

  it("zero-pads single-digit years", () => {
    expect(formatClassYear(2005)).toBe("'05");
  });
});
