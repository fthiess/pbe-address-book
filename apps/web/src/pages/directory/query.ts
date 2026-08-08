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
 *    and overridden by "Starred only" or the Deceased filter per the rules above.
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
  /**
   * Whether the structured **Deceased filter** is asking for deceased brothers
   * (OFC-399/D171) — i.e. `filters.deceased === "yes"`.
   *
   * ⚠ This is a second, independent way to switch the living-only default off, and
   * it exists because without it the new filter would have been **unusable in its
   * default state**: the D36 default hides deceased brothers, that hide is applied
   * *after* the predicate, and so "Deceased: Yes" ∧ "living only" is the empty set —
   * a filter that silently emptied the grid unless you also knew to tick a separate
   * checkbox elsewhere on the page. Forrest's call was to make the explicit request
   * carry its own inclusion, on the same reasoning D39 already applies to "Starred
   * only": asking for something by name is not a case where a default that hides it
   * should still win.
   *
   * ⚠ Deliberately a **boolean, not the filter value**: this module composes the
   * view and must not learn the filter vocabulary. `filters.ts` owns what "yes"
   * means and keeps the matching clause; this only knows a request was made.
   */
  deceasedRequested: boolean;
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
  const { matchedIds, predicate, includeDeceased, deceasedRequested, starredOnly, stars } = query;
  // The three ways the living-only default is switched off, read once: the D36
  // toggle, a curated starred list (D39 — it keeps its members even after one has
  // died), and an explicit Deceased filter (D171). Naming the disjunction rather
  // than repeating it in the guard keeps "why is this brother visible" answerable
  // from one line.
  const showDeceased = includeDeceased || starredOnly || deceasedRequested;
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
    if (isDeceased(profile) && !showDeceased) {
      return false;
    }
    return true;
  });
}
