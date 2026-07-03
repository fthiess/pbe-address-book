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

/**
 * The exact shape of a key {@link thumbnailObjectKey}/{@link headshotObjectKey}
 * can produce: a `thumbnails/` or `headshots/` prefix, a numeric Constitution id,
 * an opaque version token (`[A-Za-z0-9._-]+`, e.g. `v3`), and the `.webp`
 * extension. Anchored, with no `/` permitted inside the version, so nothing but a
 * member thumbnail/headshot can match — the `/img/*` route validates against this
 * before touching the bucket so a session holder cannot stream *any other* object
 * that happens to live there (e.g. an export CSV). See {@link isImageObjectKey}.
 */
const IMAGE_OBJECT_KEY = /^(?:thumbnails|headshots)\/\d+\/[A-Za-z0-9._-]+\.webp$/u;

/**
 * Whether `objectKey` is a well-formed member thumbnail/headshot key — the single
 * allowlist the private-bucket `/img/*` route (D126) admits. Shared so the route,
 * the URL builder, and the upload pipeline all agree on one path shape.
 */
export function isImageObjectKey(objectKey: string): boolean {
  return IMAGE_OBJECT_KEY.test(objectKey);
}

/** The kind of image an object key addresses. */
export type ImageKind = "headshots" | "thumbnails";

/** A parsed image object key: which image, whose, and which version. */
export interface ParsedImageKey {
  readonly kind: ImageKind;
  /** The brother's Constitution id the object belongs to. */
  readonly id: number;
  /** The opaque version token. */
  readonly version: string;
}

/** The same anchored shape as {@link IMAGE_OBJECT_KEY}, with capture groups. */
const IMAGE_OBJECT_KEY_PARTS = /^(thumbnails|headshots)\/(\d+)\/([A-Za-z0-9._-]+)\.webp$/u;

/**
 * Parse a member image object key into its parts, or `null` if it is not a
 * well-formed key. The `/img/*` route uses this to recover the `{id}` so it can
 * enforce **per-record visibility** (an unlisted/de-brothered brother's image is
 * withheld from a peer — DECISIONS N43), in the same single place the key shape is
 * defined. A parse success implies {@link isImageObjectKey} would return `true`.
 */
export function parseImageObjectKey(objectKey: string): ParsedImageKey | null {
  const match = IMAGE_OBJECT_KEY_PARTS.exec(objectKey);
  if (match === null) {
    return null;
  }
  const [, kind, id, version] = match;
  // The regex matched, so all three groups are present; the guard also satisfies
  // `noUncheckedIndexedAccess` without a non-null assertion.
  if (kind === undefined || id === undefined || version === undefined) {
    return null;
  }
  return { kind: kind as ImageKind, id: Number(id), version };
}

/** The app-relative URL the `/img/*` route serves an object key from (D126). */
export function imageUrl(objectKey: string): string {
  return `/img/${objectKey}`;
}
