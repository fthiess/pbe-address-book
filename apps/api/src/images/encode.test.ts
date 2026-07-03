import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  HEADSHOT_SIZE,
  THUMBNAIL_SIZE,
  UnprocessableImageError,
  encodeHeadshot,
  sniffImageType,
} from "./encode.js";

/** A solid-colour test image at the given size in the given encoding. */
function makeImage(width: number, height: number, format: "png" | "jpeg"): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 120, b: 150 } },
  });
  return (format === "png" ? base.png() : base.jpeg()).toBuffer();
}

describe("sniffImageType", () => {
  it("recognizes a JPEG by its magic bytes", async () => {
    expect(sniffImageType(await makeImage(64, 64, "jpeg"))).toBe("image/jpeg");
  });

  it("recognizes a PNG by its 8-byte signature", async () => {
    expect(sniffImageType(await makeImage(64, 64, "png"))).toBe("image/png");
  });

  it("returns null for bytes that are neither JPEG nor PNG", () => {
    expect(sniffImageType(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))).toBeNull();
    // A WEBP RIFF header is a valid image but not an accepted *upload* type.
    expect(sniffImageType(Buffer.from("RIFF....WEBP", "latin1"))).toBeNull();
  });

  it("returns null for a too-short buffer", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe("encodeHeadshot", () => {
  it("transcodes a PNG into a 512² headshot and a 96² thumbnail, both WEBP", async () => {
    const { headshot, thumbnail } = await encodeHeadshot(await makeImage(800, 800, "png"));

    const h = await sharp(headshot).metadata();
    const t = await sharp(thumbnail).metadata();
    expect(h.format).toBe("webp");
    expect(h.width).toBe(HEADSHOT_SIZE);
    expect(h.height).toBe(HEADSHOT_SIZE);
    expect(t.format).toBe("webp");
    expect(t.width).toBe(THUMBNAIL_SIZE);
    expect(t.height).toBe(THUMBNAIL_SIZE);
  });

  it("transcodes a JPEG the same way", async () => {
    const { headshot } = await encodeHeadshot(await makeImage(600, 600, "jpeg"));
    const h = await sharp(headshot).metadata();
    expect(h.format).toBe("webp");
    expect(h.width).toBe(HEADSHOT_SIZE);
  });

  it("rejects bytes that are not a supported image (→ 422)", async () => {
    await expect(encodeHeadshot(Buffer.from("not an image at all"))).rejects.toBeInstanceOf(
      UnprocessableImageError,
    );
  });

  it("rejects an image that exceeds the ~40 MP decode cap (decompression-bomb guard)", async () => {
    // 7000×7000 = 49 MP > the 40 MP limitInputPixels ceiling; the magic bytes are a
    // valid PNG, so this proves the *decode* cap, not the sniff.
    const huge = await makeImage(7000, 7000, "png");
    expect(sniffImageType(huge)).toBe("image/png");
    await expect(encodeHeadshot(huge)).rejects.toBeInstanceOf(UnprocessableImageError);
  });
});
