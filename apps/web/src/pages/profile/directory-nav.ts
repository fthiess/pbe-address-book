/**
 * Prev/next-through-the-Directory navigation model (Phase 4d, OFC-67 / N45).
 *
 * From a Profile *display* page the user can step forward/back through the
 * Directory's currently displayed set — the search ∩ filter ∩ sort result that
 * was on screen when they clicked in. That ordered id-list is stashed in React
 * Router `location.state` at the three Directory entry points (whole-row click,
 * the Canonical Name link, the card link), together with a `directoryDelta`
 * counter that records how many history entries back the true Directory entry
 * sits. Every Prev/Next is an ordinary push that re-carries the stash with
 * `directoryDelta + 1`, so "← Directory" (`navigate(-directoryDelta)`) still
 * lands on the real Directory entry — and its `location.key`-keyed scroll
 * restoration and URL filters keep working — no matter how long the chain.
 *
 * The derivation is pure and keyed only off `location.state` + the current id
 * (never the loaded record), so it is correct on the not-found path too: a
 * stashed id that has gone stale (deleted / de-brothered / unlisted / newly
 * deceased — 4c made these real) is still a member of `directoryIds`, so
 * prev/next keep rendering and the user steps past it (no auto-skip, N45).
 */

/** The `location.state` shape carried from the Directory into a Profile page. */
export interface DirectoryNavState {
  /** Set on every navigation that originated in the Directory (row / name / card) — from 4a-3. */
  fromDirectory?: boolean;
  /** The ordered id-list of the Directory's current search∩filter∩sort view (§5.6). */
  directoryIds?: number[];
  /** History distance back to the true Directory entry: 1 on the first click, +1 per Prev/Next push. */
  directoryDelta?: number;
}

/** The derived prev/next model consumed by the container and the {@link DirectoryNav} bar. */
export interface DirectoryNav {
  /** A Directory set was stashed and the current id is a member — prev/next + position render. */
  hasStash: boolean;
  /** The stashed ordered id-list (empty on a cold deep-link). */
  ids: number[];
  /** History steps back to the Directory entry (>= 1 when we came from the Directory, else 0). */
  delta: number;
  /** The current id's position in {@link ids}, or -1 when absent (cold deep-link). */
  index: number;
  /** The size of the stashed set. */
  total: number;
  /** The previous brother's id, or null at the start of the set / with no stash. */
  prevId: number | null;
  /** The next brother's id, or null at the end of the set / with no stash. */
  nextId: number | null;
}

/**
 * Derive the prev/next model from a Profile page's `location.state` and its id.
 * `delta` falls back to 1 for a `fromDirectory` entry that predates the counter,
 * and to 0 (→ "← Directory" goes to `/`) for a cold deep-link.
 */
export function deriveDirectoryNav(
  state: DirectoryNavState | null | undefined,
  currentId: number,
): DirectoryNav {
  const ids = state?.directoryIds ?? [];
  const total = ids.length;
  const index = ids.indexOf(currentId);
  const hasStash = total > 0 && index >= 0;
  const delta = state?.directoryDelta ?? (state?.fromDirectory ? 1 : 0);
  return {
    hasStash,
    ids,
    delta,
    index,
    total,
    prevId: hasStash && index > 0 ? (ids[index - 1] ?? null) : null,
    nextId: hasStash && index < total - 1 ? (ids[index + 1] ?? null) : null,
  };
}

/** The initial stash for a navigation out of the Directory (first hop; delta 1). */
export function entryNavState(directoryIds: number[]): DirectoryNavState {
  return { fromDirectory: true, directoryIds, directoryDelta: 1 };
}

/** The stash for a Prev/Next push: same id-list, one history step further from the Directory. */
export function stepNavState(nav: DirectoryNav): DirectoryNavState {
  return { fromDirectory: true, directoryIds: nav.ids, directoryDelta: nav.delta + 1 };
}
