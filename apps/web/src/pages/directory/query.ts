import type { DirectoryProfile } from "../../lib/types.js";

/**
 * The Directory's **client query engine** (PRD §5.6.3–5.6.6) — the single pure
 * function that narrows the in-memory dataset to the rows a view shows, before
 * the comparator sorts them. Everything runs client-side over the already-
 * projected data (D4/D5). Composition, in order:
 *
 *  - **Name Search** — the worker's (or main-thread substring) match set;
 *    `matchedIds === null` means "no query, match all" (D35).
 *  - **Starred only** — restrict to the viewer's starred set (D39). It is
 *    AND-ed with search and the structured filters, but **bypasses the deceased
 *    default**: a hand-picked list shows starred brothers living *or* deceased.
 *  - **Structured filters** — the typed filter predicate, OR-within / AND-across
 *    (D38); an empty filter set is the always-true predicate.
 *  - **Deceased default** — living-only unless "Include deceased" is on (D36),
 *    and always overridden by "Starred only" per the rule above.
 *
 * Keeping this as one tested pure function (ENGINEERING-DESIGN §6 — "the client
 * query engine, tested solidly") means the live UI and the unit tests exercise
 * the exact same composition.
 */
export interface DirectoryQuery {
  /** Name-search matches, or null for "no active query" (match all). */
  matchedIds: ReadonlySet<number> | null;
  /** The structured-filter predicate; defaults to always-true. */
  predicate?: (profile: DirectoryProfile) => boolean;
  /** Whether deceased brothers are included (the D36 toggle). */
  includeDeceased: boolean;
  /** Whether to restrict to the viewer's starred set (D39). */
  starredOnly: boolean;
  /** The viewer's starred brother ids — consulted only when `starredOnly`. */
  stars: ReadonlySet<number>;
}

/** Whether a record is flagged deceased (the projection may omit the block entirely). */
function isDeceased(profile: DirectoryProfile): boolean {
  return profile.deceased?.isDeceased === true;
}

/** Apply the full query to the dataset, returning the matching rows (unsorted). */
export function filterRows(
  profiles: readonly DirectoryProfile[],
  query: DirectoryQuery,
): DirectoryProfile[] {
  const { matchedIds, predicate, includeDeceased, starredOnly, stars } = query;
  return profiles.filter((profile) => {
    if (matchedIds !== null && !matchedIds.has(profile.id)) {
      return false;
    }
    if (starredOnly && !stars.has(profile.id)) {
      return false;
    }
    if (predicate && !predicate(profile)) {
      return false;
    }
    // The deceased default is the only filter "Starred only" overrides (D39):
    // a curated list keeps its members even after one has died.
    if (isDeceased(profile) && !includeDeceased && !starredOnly) {
      return false;
    }
    return true;
  });
}
