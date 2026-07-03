import sharp from "sharp";

/**
 * The headshot image encode step (API-SPEC §6; DECISIONS D17/D47/N42).
 *
 * A brother's uploaded photo — already framed 1:1 and downscaled to ≤1024² JPEG
 * by the client crop UI — is re-decoded and re-encoded here into the two
 * immutable WEBP objects the app serves: the **512² headshot** shown on the
 * Profile page and the **96² thumbnail** shown in the Directory. The client
 * preprocessing is a courtesy for the slow-link audience, never a trust boundary
 * (D107): the bytes are validated by **magic-byte inspection** (not the declared
 * `Content-Type`) and bounded to ≈40 MP decoded so a decompression bomb cannot
 * exhaust the single instance, and the transcode always runs regardless of what
 * the client claims to have sent.
 *
 * Both derivatives are produced from **one decode** ({@link sharp.clone}), and
 * `fit: "cover"` re-squares defensively even though the crop is already 1:1.
 */

/** The size of the stored headshot object, in pixels (square). */
export const HEADSHOT_SIZE = 512;
/** The size of the stored directory thumbnail, in pixels (square). */
export const THUMBNAIL_SIZE = 96;

/**
 * The decoded-pixel ceiling (~40 MP) passed to sharp's `limitInputPixels`. A
 * genuine high-resolution headshot is far below this; the cap exists only to
 * bounce a decompression bomb before it allocates (D107). A 6000×6000 (36 MP)
 * original still clears it.
 */
export const MAX_DECODED_PIXELS = 40_000_000;

/** WEBP quality for both derivatives — visually lossless for a headshot at these sizes. */
const WEBP_QUALITY = 82;

/** The MIME types the upload path accepts, keyed by the magic bytes below. */
export type SupportedImageType = "image/jpeg" | "image/png";

/** The two WEBP buffers a successful encode yields, ready to write to the bucket. */
export interface EncodedHeadshot {
  /** The 512² headshot object body. */
  readonly headshot: Buffer;
  /** The 96² thumbnail object body. */
  readonly thumbnail: Buffer;
}

/**
 * Raised when an upload's bytes are not a supported image or exceed the decode
 * cap — every case the route surfaces as a `422` (API-SPEC §6). Distinct from a
 * `415` (an unsupported *declared* `Content-Type`, which Fastify rejects before
 * the body is ever read): a `422` means the bytes themselves failed inspection.
 */
export class UnprocessableImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnprocessableImageError";
  }
}

/**
 * Identify the image type from its **leading bytes**, independent of any declared
 * `Content-Type` (which a client controls and we never trust — D107). Returns the
 * detected type, or `null` if the bytes are neither JPEG nor PNG.
 *
 *  - JPEG starts with `FF D8 FF`.
 *  - PNG starts with the 8-byte signature `89 50 4E 47 0D 0A 1A 0A`.
 */
export function sniffImageType(bytes: Buffer): SupportedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

/**
 * Validate and transcode an uploaded image into the stored 512² headshot and 96²
 * thumbnail WEBP buffers. Throws {@link UnprocessableImageError} when the bytes
 * fail the magic-byte check or the ≈40 MP decode cap (→ `422`); a decoder failure
 * on otherwise-plausible bytes maps to the same error rather than a `500`.
 *
 * The `limitInputPixels` guard is applied to the shared decoder so both
 * derivatives inherit it, and EXIF is dropped implicitly by the re-encode (a
 * privacy win layered on the client's own canvas strip — N42).
 */
export async function encodeHeadshot(bytes: Buffer): Promise<EncodedHeadshot> {
  if (sniffImageType(bytes) === null) {
    throw new UnprocessableImageError("Upload is not a JPEG or PNG image.");
  }

  // One decode, cloned for each derivative so the bytes are parsed a single time
  // under the shared pixel cap. `failOn: "error"` rejects truncated/corrupt data.
  const decoder = sharp(bytes, { limitInputPixels: MAX_DECODED_PIXELS, failOn: "error" });

  try {
    const [headshot, thumbnail] = await Promise.all([
      decoder
        .clone()
        .resize(HEADSHOT_SIZE, HEADSHOT_SIZE, { fit: "cover", position: "centre" })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer(),
      decoder
        .clone()
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "cover", position: "centre" })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer(),
    ]);
    return { headshot, thumbnail };
  } catch (error) {
    // A pixel-limit trip or any decode failure is a bad upload, not a server
    // fault: surface it as the route's 422 (API-SPEC §6), never a 500.
    throw new UnprocessableImageError(`Could not process the image: ${(error as Error).message}`);
  }
}
