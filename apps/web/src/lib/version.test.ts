import { describe, expect, it } from "vitest";
import { isDifferentVersion } from "./version.js";

/**
 * The update-toast gate (OFC-63). It fires only for a real, different deployed
 * build id — never on an equal id, and never on the absent/empty result of a
 * failed poll or a dev build with no `version.json`, so the toast can't false-nag.
 */
describe("isDifferentVersion (OFC-63)", () => {
  it("prompts when the deployed id differs from the loaded id", () => {
    expect(isDifferentVersion("abc123", "def456")).toBe(true);
  });

  it("does not prompt when the ids match", () => {
    expect(isDifferentVersion("abc123", "abc123")).toBe(false);
  });

  it("does not prompt on an absent or empty deployed id (a failed/dev poll)", () => {
    expect(isDifferentVersion("abc123", null)).toBe(false);
    expect(isDifferentVersion("abc123", "")).toBe(false);
  });
});
