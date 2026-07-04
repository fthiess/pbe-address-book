/**
 * Prev/next-through-the-Directory navigation model (Phase 4d, OFC-67 / N45).
 *
 * From a Profile *display* page the user can step forward/back through the
 * Directory's currently displayed set — the search ∩ filter ∩ sort result that
 * was on screen when they clicked in. That ordered id-list is stored once (see
 * `directory-stash.ts`, OFC-141) under a short `stashId`; the `stashId` plus a
 * `directoryDelta` counter travel in React Router `location.state`. `delta`
 * records how many history entries back the true Directory entry sits: every
 * Prev/Next is an ordinary push that re-carries the same `stashId` with
 * `directoryDelta + 1`, so "← Directory" (`navigate(-directoryDelta)`) still
 * lands on the real Directory entry — and its `location.key`-keyed scroll
 * restoration and URL filters keep working — no matter how long the chain.
 *
 * This module is pure: {@link deriveDirectoryNav} takes the already-resolved
 * id-list (the container reads it from the stash store) and never touches storage
 * itself, so it is trivially unit-testable and correct on the not-found path too
 * — a stale stashed id (deleted / de-brothered / unlisted / newly deceased) is
 * still a *member* of the id-list, so prev/next keep rendering and the user steps
 * past it (no auto-skip, N45).
 */

/** A Prev/Next step direction — used to re-focus the pressed control after the route change (OFC-144). */
export type StepDirection = "prev" | "next";

/** The `location.state` shape carried from the Directory into a Profile page. */
export interface DirectoryNavState {
  /** Set on every navigation that originated in the Directory (row / name / card) — from 4a-3. */
  fromDirectory?: boolean;
  /** Handle to the stashed ordered id-list of the current search∩filter∩sort view (OFC-141). */
  stashId?: string;
  /** History distance back to the true Directory entry: 1 on the first click, +1 per Prev/Next push. */
  directoryDelta?: number;
}

/** The derived prev/next model consumed by the container and the {@link DirectoryNav} bar. */
export interface DirectoryNav {
  /** A Directory set was stashed and the current id is a member — prev/next + position render. */
  hasStash: boolean;
  /** The resolved ordered id-list (empty on a cold deep-link or an evicted/missing stash). */
  ids: number[];
  /** The stash handle, re-carried onto each Prev/Next push. */
  stashId?: string;
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
 * Derive the prev/next model from a Profile page's `location.state`, its id, and
 * the id-list already resolved from the stash store. `delta` falls back to 1 for
 * a `fromDirectory` entry that predates the counter, and to 0 (→ "← Directory"
 * goes to `/`) for a cold deep-link.
 */
export function deriveDirectoryNav(
  state: DirectoryNavState | null | undefined,
  currentId: number,
  ids: number[],
): DirectoryNav {
  const total = ids.length;
  const index = ids.indexOf(currentId);
  const hasStash = total > 0 && index >= 0;
  const delta = state?.directoryDelta ?? (state?.fromDirectory ? 1 : 0);
  return {
    hasStash,
    ids,
    stashId: state?.stashId,
    delta,
    index,
    total,
    prevId: hasStash && index > 0 ? (ids[index - 1] ?? null) : null,
    nextId: hasStash && index < total - 1 ? (ids[index + 1] ?? null) : null,
  };
}

/** The stash for a Prev/Next push: same stash handle, one history step further from the Directory. */
export function stepNavState(nav: DirectoryNav): DirectoryNavState {
  return { fromDirectory: true, stashId: nav.stashId, directoryDelta: nav.delta + 1 };
}
