import { parseImageObjectKey } from "@pbe/shared";
import { describe, expect, it } from "vitest";
import { classifyHeadshotFiles, headshotVersionOf, primaryHeadshotId } from "./headshot-files.js";

describe("primaryHeadshotId", () => {
  it("accepts un-suffixed primaries, hyphenated names and the pipeline's -0 unknown year", () => {
    expect(primaryHeadshotId("5247-James-Smyth-1984.png")).toBe(5247);
    expect(primaryHeadshotId("5247-James-van-Smyth-1984.png")).toBe(5247);
    expect(primaryHeadshotId("5247-James-Smyth-0.png")).toBe(5247);
    expect(primaryHeadshotId("5247-James-Smyth-1984-2.png")).toBeNull();
    expect(primaryHeadshotId("headshots.csv")).toBeNull();
    expect(primaryHeadshotId("unused")).toBeNull();
  });
});

describe("classifyHeadshotFiles", () => {
  it("separates primaries, alternates, duplicates and unrecognised PNGs", () => {
    const files = classifyHeadshotFiles([
      "5247-James-Smyth-1984.png",
      "5247-James-Smyth-1984-2.png",
      "5248-Jim-Smyth-0.png",
      "5249-A-B-1990.png",
      "5249-C-D-1990.png",
      "stray.png",
      "headshots.csv",
      "unused",
    ]);
    expect([...files.primaries.entries()]).toEqual([
      [5247, "5247-James-Smyth-1984.png"],
      [5248, "5248-Jim-Smyth-0.png"],
      [5249, "5249-A-B-1990.png"],
    ]);
    expect(files.duplicates).toEqual([5249]);
    expect(files.unrecognised).toEqual(["stray.png"]);
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
