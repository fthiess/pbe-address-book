/**
 * Member-image object-key contract — the single definition of *where* a
 * brother's headshot and thumbnail live in the private image bucket (D9/D126).
 *
 * This is deliberately shared: the SPA builds the `/img/*` URL from it, the
 * staging seeder uploads placeholder fixtures to it, and the Phase-4 headshot
 * pipeline (the real crop/encode step) writes its output to it. One definition
 * means the three can never disagree on the key, so test fixtures and real
 * generated images occupy the exact same path — the fixtures stand in for
 * content, never for the contract.
 *
 * Both images are immutable, versioned objects: a new upload yields a new
 * `version` token (and thus a new key/URL) rather than mutating an old one, so
 * the bytes can be cached hard in the browser (R16, the `/img/*` route's
 * `immutable` cache header). The headshot is the full 512² WEBP shown on the
 * Profile page (Phase 4); the thumbnail is the 96² WEBP shown in the Directory.
 */

/** Bucket object key for a brother's 96² Directory thumbnail. */
export function thumbnailObjectKey(id: number, version: string): string {
  return `thumbnails/${id}/${version}.webp`;
}

/** Bucket object key for a brother's 512² Profile headshot (Phase 4). */
export function headshotObjectKey(id: number, version: string): string {
  return `headshots/${id}/${version}.webp`;
}

/** The app-relative URL the `/img/*` route serves an object key from (D126). */
export function imageUrl(objectKey: string): string {
  return `/img/${objectKey}`;
}
