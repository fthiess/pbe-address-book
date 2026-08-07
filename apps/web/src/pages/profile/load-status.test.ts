import { describe, expect, it } from "vitest";
import { statusFor } from "./load-status.js";

describe("statusFor", () => {
  it("separates a missing record from a withheld one (D168)", () => {
    expect(statusFor(404)).toBe("notfound");
    expect(statusFor(403)).toBe("private");
  });

  it("keeps every other failure retryable rather than claiming a dead end", () => {
    // A cold instance that never woke, an offline link, a 500: we did not learn
    // that the record is missing or private, so we must not say either.
    for (const status of [0, 401, 429, 500, 502, 503]) {
      expect(statusFor(status)).toBe("error");
    }
  });
});
