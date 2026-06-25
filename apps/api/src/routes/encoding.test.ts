import { describe, expect, it } from "vitest";
import { negotiateEncoding } from "./encoding.js";

describe("negotiateEncoding", () => {
  it("prefers brotli when offered", () => {
    expect(negotiateEncoding("gzip, deflate, br")).toBe("br");
  });

  it("falls back to gzip when br is absent", () => {
    expect(negotiateEncoding("gzip, deflate")).toBe("gzip");
  });

  it("returns identity when neither is offered", () => {
    expect(negotiateEncoding("deflate")).toBe("identity");
  });

  it("returns identity when the header is missing", () => {
    expect(negotiateEncoding(undefined)).toBe("identity");
  });

  it("ignores q-values and surrounding whitespace", () => {
    expect(negotiateEncoding("gzip;q=1.0, br;q=0.8")).toBe("br");
  });

  it("is case-insensitive", () => {
    expect(negotiateEncoding("BR")).toBe("br");
  });
});
