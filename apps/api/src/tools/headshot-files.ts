/**
 * The naming and versioning contract shared by `csv-to-snapshot.ts` (which stamps
 * `headshotVersion` into the snapshot) and `load-headshots.ts` (which uploads the
 * bytes under that version). Pure, so the agreement between the two is testable.
 */
import { createHash } from "node:crypto";

/**
 * A PRIMARY prepared headshot is `<NNNN>-<First>-<Last>-<YYYY>.png`; alternates
 * carry a trailing `-<n>` before the extension and are ignored (the photo
 * pipeline's README: "the un-suffixed file is the primary").
 */
const PRIMARY_RE = /^(\d{4})-.+-\d{4}\.png$/u;

/** The Constitution ID a primary headshot file belongs to, or null if not one. */
export function primaryHeadshotId(fileName: string): number | null {
  const match = PRIMARY_RE.exec(fileName);
  if (!match?.[1]) {
    return null;
  }
  return Number(match[1]);
}

/**
 * The `headshotVersion` token for a photo: a content hash, so re-running either
 * tool on the same bytes yields the same object key (idempotent uploads), and a
 * changed photo changes the key (the image bucket's immutable-cache posture, D94).
 * Fits the object-key grammar `[A-Za-z0-9._-]+` (`parseImageObjectKey`).
 */
export function headshotVersionOf(bytes: Uint8Array): string {
  return `g${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
}
