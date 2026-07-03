import type { Readable } from "node:stream";
import { getStorage } from "firebase-admin/storage";

/**
 * The member-image object store (D126). Headshots and thumbnails live as
 * immutable, versioned objects in a **private** GCS bucket; the app is the only
 * access path (no Cloud CDN, no signed URLs). This is the write/read seam the
 * headshot pipeline and the `/img/*` route go through — injected like
 * {@link ProfileStore}, so route tests drive the whole flow against an in-memory
 * double while a real `GcsImageStore` talks to the bucket in every deployed
 * environment.
 *
 * The object-key shape is owned by `@pbe/shared` (`parseImageObjectKey`); this
 * store deals only in already-validated keys.
 */

/** An object read back from the store: its content type and a streamable body. */
export interface StoredImage {
  readonly contentType: string;
  /** A Buffer (fake) or a Node stream (GCS); Fastify's `reply.send` accepts both. */
  readonly body: Readable | Buffer;
}

/** The image store seam (real = GCS; tests = in-memory). */
export interface ImageStore {
  /** Write (create-or-replace) an object with the given body and content type. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Delete an object; a missing object is **not** an error (idempotent purge, D94). */
  delete(key: string): Promise<void>;
  /** Read an object, or `null` if it does not exist (→ the route's `404`). */
  read(key: string): Promise<StoredImage | null>;
}

/**
 * Raised when no image bucket is configured (`IMAGE_BUCKET` unset). The routes
 * translate it to a `503` — the same "image storage unconfigured" signal the
 * Phase-1 route returned — rather than letting an undefined bucket name reach the
 * GCS client as a confusing lower-level error.
 */
export class ImageBucketUnconfiguredError extends Error {
  constructor() {
    super("No image bucket is configured (IMAGE_BUCKET is unset).");
    this.name = "ImageBucketUnconfiguredError";
  }
}

/** GCS status code for a missing object (both `getMetadata` and `delete` use it). */
const GCS_NOT_FOUND = 404;

/**
 * The real store: objects in the private GCS bucket named by `IMAGE_BUCKET`. The
 * bucket handle is resolved lazily per call (after `firebase-admin` is
 * initialized), matching the Phase-1 route's `getStorage()`-at-request-time shape.
 */
export class GcsImageStore implements ImageStore {
  constructor(private readonly bucketName: string | undefined) {}

  private bucket() {
    if (!this.bucketName) {
      throw new ImageBucketUnconfiguredError();
    }
    return getStorage().bucket(this.bucketName);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    // `resumable: false` is the right choice for these small (≤~50 KB) single-shot
    // writes — a resumable session would add a round trip for no benefit.
    await this.bucket().file(key).save(body, { contentType, resumable: false });
  }

  async delete(key: string): Promise<void> {
    // `ignoreNotFound` keeps the purge idempotent: deleting an already-gone
    // superseded object (or a double-fired cleanup) is a success, not a throw.
    await this.bucket().file(key).delete({ ignoreNotFound: true });
  }

  async read(key: string): Promise<StoredImage | null> {
    const file = this.bucket().file(key);
    // One round trip (mirrors OFC-80 on the old route): `getMetadata()` already
    // 404s on a missing object, so a prior `exists()` is redundant and a TOCTOU
    // window. A GCS 404 is not-found; anything else propagates as a 500.
    try {
      const [metadata] = await file.getMetadata();
      return {
        contentType: metadata.contentType ?? "application/octet-stream",
        body: file.createReadStream(),
      };
    } catch (error) {
      if ((error as { code?: number }).code === GCS_NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }
}
