import { describe, expect, it } from "vitest";
import { headshotObjectKey, imageUrl, parseImageObjectKey, thumbnailObjectKey } from "./images.js";

describe("image object keys", () => {
  it("builds versioned thumbnail and headshot keys", () => {
    expect(thumbnailObjectKey(5247, "v3")).toBe("thumbnails/5247/v3.webp");
    expect(headshotObjectKey(5247, "v3")).toBe("headshots/5247/v3.webp");
    expect(imageUrl(headshotObjectKey(5247, "v3"))).toBe("/img/headshots/5247/v3.webp");
  });

  it("round-trips build → parse", () => {
    const key = headshotObjectKey(5247, "a1b2c3");
    expect(parseImageObjectKey(key)).toEqual({ kind: "headshots", id: 5247, version: "a1b2c3" });
    expect(parseImageObjectKey(thumbnailObjectKey(42, "v9"))).toEqual({
      kind: "thumbnails",
      id: 42,
      version: "v9",
    });
  });

  it("accepts only the two literal shapes and rejects everything else", () => {
    for (const good of ["headshots/1/v.webp", "thumbnails/9999/AbC-1._2.webp"]) {
      expect(parseImageObjectKey(good)).not.toBeNull();
    }
    for (const bad of [
      "secret.csv",
      "headshots/5001", // no version
      "headshots/5001/v.png", // wrong extension
      "avatars/5001/v.webp", // wrong prefix
      "headshots/abc/v.webp", // non-numeric id
      "headshots/5001/../etc.webp", // traversal in version segment
      "headshots/5001/v/w.webp", // slash inside version
      "", // empty
    ]) {
      expect(parseImageObjectKey(bad)).toBeNull();
    }
  });
});
