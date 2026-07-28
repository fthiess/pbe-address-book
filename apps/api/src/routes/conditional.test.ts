import { describe, expect, it } from "vitest";
import { ifNoneMatchSatisfied } from "./conditional.js";

const ETAG = "abcdef0123456789.brother";

describe("ifNoneMatchSatisfied (7.5b)", () => {
  it("matches the client's quoted single token", () => {
    expect(ifNoneMatchSatisfied(`"${ETAG}"`, ETAG)).toBe(true);
  });

  it("matches an unquoted token (a lenient intermediary)", () => {
    expect(ifNoneMatchSatisfied(ETAG, ETAG)).toBe(true);
  });

  it("matches through a W/ weak prefix", () => {
    expect(ifNoneMatchSatisfied(`W/"${ETAG}"`, ETAG)).toBe(true);
  });

  it("matches within a comma-separated list", () => {
    expect(ifNoneMatchSatisfied(`"other", "${ETAG}"`, ETAG)).toBe(true);
  });

  it("rejects a different token, an empty header, and an absent header", () => {
    expect(ifNoneMatchSatisfied('"someone-elses.admin"', ETAG)).toBe(false);
    expect(ifNoneMatchSatisfied("", ETAG)).toBe(false);
    expect(ifNoneMatchSatisfied(undefined, ETAG)).toBe(false);
  });

  it("does not honor `*` — deliberately narrower than RFC 9110", () => {
    expect(ifNoneMatchSatisfied("*", ETAG)).toBe(false);
  });

  it("a role-qualified token never matches across roles", () => {
    expect(ifNoneMatchSatisfied('"abcdef0123456789.brother"', "abcdef0123456789.admin")).toBe(
      false,
    );
  });
});
