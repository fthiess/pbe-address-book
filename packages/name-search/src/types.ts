/**
 * Shared types for the Name-Search matcher (`@pbe/name-search`). The package is
 * pure logic with no DOM dependency, so the Directory's Web Worker (D110) and the
 * offline phonetic A/B harness (D66) build and query the *identical* index from
 * the same code — which is what keeps the harness honest about what ships.
 */

/**
 * The minimal per-brother shape the matcher indexes — the searched name fields
 * only (D35): the structured name parts plus the already-resolved Canonical Name
 * display string. A structural subset of `Profile`, so the worker can post a
 * lean clone and the harness can build records from any source. Every field is
 * optional because the projection may withhold any of them.
 */
export interface NameRecord {
  /** Constitution ID — the stable identity returned by a search. */
  id: number;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullLegalName?: string;
  mugName?: string;
  /** The resolved Canonical Name (`First Last 'YY`), included per D35. */
  canonicalName?: string;
}

/** Which phonetic algorithm the index uses (the D66 A/B choice; `none` disables it). */
export type PhoneticAlgorithm = "double-metaphone" | "beider-morse" | "none";

/**
 * The tunable knobs of the matcher — the phonetic algorithm (D35/D66) and the
 * bidirectional common-nickname expansion (D123). Both are config-flagged and
 * A/B-tunable exactly as the design specifies; {@link DEFAULT_SEARCH_CONFIG}
 * carries the locked-in production values.
 */
export interface SearchConfig {
  phonetic: PhoneticAlgorithm;
  nicknames: boolean;
}

/** A half-open `[start, end)` character range within a display string to mark. */
export interface HighlightRange {
  start: number;
  end: number;
}
