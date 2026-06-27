import { describe, expect, it } from "vitest";
import { expandNickname } from "./nicknames.js";

describe("expandNickname (D123)", () => {
  it("expands bidirectionally — formal finds nickname and vice versa", () => {
    expect(expandNickname("bill")).toContain("william");
    expect(expandNickname("william")).toContain("bill");
    expect(expandNickname("tom")).toContain("thomas");
    expect(expandNickname("thomas")).toContain("tom");
  });

  it("includes the queried token itself in the group", () => {
    expect(expandNickname("bob")).toContain("bob");
    expect(expandNickname("robert")).toContain("robert");
  });

  it("unions every group a name belongs to (over-matching is tolerable)", () => {
    // "al" is short for Albert, Alan, and Alfred — all should be reachable.
    const al = expandNickname("al");
    expect(al).toEqual(expect.arrayContaining(["albert", "alan", "alfred"]));
  });

  it("returns just the token for a name with no known nicknames", () => {
    expect(expandNickname("zebadiah")).toEqual(["zebadiah"]);
  });
});
