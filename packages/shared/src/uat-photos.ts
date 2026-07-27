/**
 * The UAT photo-corpus fixture contract (OFC-249) — the single definition shared
 * by the tool that *produces* the prepared corpus (`apps/api/src/tools/
 * prepare-uat-photos.ts`) and the seeder that *consumes* it
 * (`tools/fake-data/src/seed-staging-images.ts`).
 *
 * The two live in different workspace packages and never call each other; all
 * they share is a directory layout and a manifest. Defining that here is the same
 * move `images.ts` makes for the bucket object keys, for the same reason: one
 * definition means producer and consumer cannot drift, and a rename is a
 * type error rather than a silent 404 at seed time.
 *
 * Nothing here is imported by the SPA. The types erase at compile time and the one
 * function is a named export, so it tree-shakes out of the web bundle (D74's byte
 * ceiling is a CI gate — keep it that way).
 */

/**
 * The manifest written alongside the prepared derivatives.
 *
 * It exists so the seeder can characterize a prepared set **without** re-reading
 * every object: `count` bounds the index range, and the two sizes record which
 * encode produced these bytes. That last part is the point — the corpus is
 * prepared once and then sits in a bucket indefinitely, so a later change to
 * `HEADSHOT_SIZE` or `THUMBNAIL_SIZE` in `apps/api/src/images/encode.ts` would
 * otherwise leave staging quietly serving wrong-sized fixtures with nothing
 * anywhere to notice. The seeder compares and warns.
 */
export interface UatPhotoManifest {
  /** Manifest schema version, so a future shape change is detectable. */
  readonly version: 1;
  /** How many photos the set holds; indices run `0 .. count-1`. */
  readonly count: number;
  /** The headshot edge length, in pixels, these derivatives were encoded at. */
  readonly headshotSize: number;
  /** The thumbnail edge length, in pixels, these derivatives were encoded at. */
  readonly thumbnailSize: number;
  /**
   * Index → original source filename, in the deterministic (filename-sorted) order
   * the preparer used. Kept so "which generated face landed on #5247?" stays
   * answerable after the files are renamed to bare indices.
   */
  readonly photos: readonly { readonly index: number; readonly source: string }[];
}

/**
 * The object name for a prepared photo at `index`, zero-padded to four digits.
 *
 * Padded rather than bare so the objects sort lexicographically in the same order
 * they were assigned — which is how a human listing the bucket can confirm the set
 * is complete and contiguous at a glance.
 */
export function uatPhotoName(index: number): string {
  return `${String(index).padStart(4, "0")}.webp`;
}

/** The manifest's object key beneath a prepared-corpus prefix. */
export function uatManifestKey(prefix: string): string {
  return `${prefix.replace(/\/$/, "")}/manifest.json`;
}

/**
 * The object key for one prepared derivative. `kind` matches the image-bucket
 * vocabulary (`headshots` / `thumbnails`) deliberately: the prepared layout mirrors
 * the served layout, so the seeder's copy is index → key with no translation table.
 */
export function uatPhotoKey(
  prefix: string,
  kind: "headshots" | "thumbnails",
  index: number,
): string {
  return `${prefix.replace(/\/$/, "")}/${kind}/${uatPhotoName(index)}`;
}
