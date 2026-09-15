import { parseImageObjectKey } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { headshotVersionOf, primaryHeadshotId } from "./headshot-files.js";

describe("primaryHeadshotId", () => {
  it("accepts un-suffixed primaries, including hyphenated names, and rejects alternates", () => {
    expect(primaryHeadshotId("5247-James-Smyth-1984.png")).toBe(5247);
    expect(primaryHeadshotId("5247-James-van-Smyth-1984.png")).toBe(5247);
    expect(primaryHeadshotId("5247-James-Smyth-1984-2.png")).toBeNull();
    expect(primaryHeadshotId("headshots.csv")).toBeNull();
    expect(primaryHeadshotId("unused")).toBeNull();
  });
});

describe("headshotVersionOf", () => {
  it("is deterministic, content-sensitive and a legal object-key version", () => {
    const a = headshotVersionOf(Buffer.from("png-bytes"));
    expect(headshotVersionOf(Buffer.from("png-bytes"))).toBe(a);
    expect(headshotVersionOf(Buffer.from("other"))).not.toBe(a);
    expect(parseImageObjectKey(`headshots/5247/${a}.webp`)).toEqual({
      kind: "headshots",
      id: 5247,
      version: a,
    });
  });
});
