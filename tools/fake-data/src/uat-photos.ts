/**
 * Deciding which image each `hasHeadshot` fake profile gets (OFC-249).
 *
 * Split out from `seed-staging-images.ts` — which is a top-level script of pure
 * I/O — so the one part with actual logic can be tested without a bucket.
 */

/** How many committed placeholder fixtures exist (`fixtures/{headshots,thumbnails}/`). */
export const PLACEHOLDER_COUNT = 8;

/** Where one profile's seeded image bytes come from. */
export type PhotoSource =
  /** The `index`-th photo of the prepared UAT corpus (a realistic fake face). */
  | { readonly kind: "uat"; readonly index: number }
  /** The `variant`-th committed placeholder fixture (a tinted silhouette). */
  | { readonly kind: "placeholder"; readonly variant: number };

/** One profile's image assignment. */
export interface PhotoAssignment {
  readonly profileId: number;
  readonly source: PhotoSource;
}

/**
 * Assign images to the profiles that carry `hasHeadshot`.
 *
 * **Deterministic by construction**: profiles are taken in ascending id order and
 * the corpus in ascending index order, so the same generator + the same corpus put
 * the same face on the same brother on every reseed. That matters more than it
 * sounds — under random assignment, "my photo changed after the last deploy" is a
 * bug report a tester would be right to file and nobody could reproduce.
 *
 * The corpus is smaller than the population it dresses (408 photos against 438
 * `hasHeadshot` profiles at the time of writing), so the lowest ids take the real
 * faces and the remainder fall back to the committed placeholders. **Repeats are
 * deliberately not used to close the gap**: cycling the corpus would put the same
 * face on two brothers, and a duplicated *face* reads as a data-integrity bug,
 * whereas a tinted silhouette reads as "no photo on file" — which is exactly what
 * it means, and which a third of the real membership will legitimately show.
 *
 * @param profileIds ids of every profile carrying `hasHeadshot` (any order).
 * @param uatPhotoCount photos in the prepared corpus; `0` means placeholders only.
 */
export function planPhotoAssignments(
  profileIds: readonly number[],
  uatPhotoCount: number,
): PhotoAssignment[] {
  // Sort explicitly rather than trusting the caller: the generator happens to emit
  // ascending ids today, so relying on that would work by accident and break
  // silently if the generator ever reordered.
  const ordered = [...profileIds].sort((a, b) => a - b);
  const realFaces = Math.max(0, Math.min(uatPhotoCount, ordered.length));

  return ordered.map((profileId, position) => ({
    profileId,
    source:
      position < realFaces
        ? { kind: "uat", index: position }
        : // Keyed on the id, not the position, so a profile's placeholder tint is
          // stable even if the corpus size changes and shifts the boundary.
          { kind: "placeholder", variant: profileId % PLACEHOLDER_COUNT },
  }));
}

/** How an assignment plan divides, for the seeder's summary line. */
export interface PhotoAssignmentTally {
  readonly uat: number;
  readonly placeholder: number;
  /** Prepared photos the population was too small to use; normally 0. */
  readonly unusedPhotos: number;
}

/** Count a plan's split so the seeder can report it (and a human can sanity-check it). */
export function tallyAssignments(
  assignments: readonly PhotoAssignment[],
  uatPhotoCount: number,
): PhotoAssignmentTally {
  const uat = assignments.filter((a) => a.source.kind === "uat").length;
  return {
    uat,
    placeholder: assignments.length - uat,
    unusedPhotos: Math.max(0, uatPhotoCount - uat),
  };
}
