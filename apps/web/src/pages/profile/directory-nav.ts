/**
 * Prev/next-through-the-Directory navigation model (Phase 4d, OFC-67 / N45).
 *
 * From a Profile *display* page the user can step forward/back through the
 * Directory's currently displayed set — the search ∩ filter ∩ sort result that
 * was on screen when they clicked in. That ordered id-list is stored once (see
 * `directory-stash.ts`, OFC-141) under a short `stashId`; the `stashId` plus a
 * `directoryDelta` counter travel in React Router `location.state`. `delta`
 * records how many history entries back the true Directory entry sits, so
 * "← Directory" (`navigate(-directoryDelta)`) lands on the real Directory entry
 * and its `location.key`-keyed scroll restoration and URL filters keep working.
 *
 * **A Prev/Next step REPLACES its history entry rather than pushing one**
 * (OFC-395). N45 originally pushed and counted `directoryDelta + 1` per step, so
 * a long walk built a chain as deep as the set was long — and a browser session
 * history is *bounded*: Chrome keeps at most 50 entries per tab and prunes from
 * the oldest end, taking the Directory entry with it. `history.go()` past the
 * start of the stack is a **silent no-op**, so past ~50 steps "← Directory"
 * simply stopped working, with no error to see and no failed navigation to
 * report. UAT found it on a 168-brother filtered set. Replacing instead pins
 * `delta` at 1 for the whole walk, which makes the failure structurally
 * impossible rather than merely rarer. The cost, accepted deliberately: the
 * browser's own Back button no longer retraces the brothers stepped past — from
 * anywhere in a chain it goes straight to the Directory. Prev already *is* the
 * step-back-through-the-set affordance.
 *
 * Because `history.go()` can never report failure, {@link directoryEntryIsReachable}
 * lets the caller find out *before* asking, and the stash carries the Directory's
 * URL so an unreachable entry can still be rebuilt by navigating to it.
 *
 * This module is pure: {@link deriveDirectoryNav} takes the already-resolved
 * stash (the container reads it from the stash store) and never touches storage
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
  /**
   * History distance back to the true Directory entry: 1 on the first click, and
   * unchanged by a Prev/Next step (which replaces rather than pushes — OFC-395).
   * Only a genuine *branch* off the walk pushes an entry and increments it.
   */
  directoryDelta?: number;
}

/**
 * A stashed Directory view: the ordered id-list Prev/Next steps through, plus the
 * URL that produced it.
 *
 * The URL is the recovery path for the one case a POP cannot serve — the Directory
 * entry is gone from the session history, so there is nothing to pop back *to*
 * (OFC-395). Navigating to it restores search / filter / sort exactly and loses
 * only scroll position, which the `location.key`-keyed restoration cannot follow to
 * a freshly-created entry. It is the user's own view of their own Directory, held
 * in `sessionStorage` beside the id-list and never sent anywhere — in particular
 * it must never reach an analytics event, which is the whole point of the
 * route-pattern design in `useAnalytics.ts` (a Directory URL carries `?q=`).
 */
export interface DirectoryStash {
  /** The ordered ids of the displayed set, or empty when absent/evicted/unavailable. */
  ids: number[];
  /** The Directory's `pathname + search` at click-through, or `""` when unknown. */
  url: string;
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
  /** The Directory URL to rebuild when its history entry is unreachable (`""` if unknown). */
  directoryUrl: string;
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
 * the stash already resolved from the stash store. `delta` falls back to 1 for
 * a `fromDirectory` entry that predates the counter, and to 0 (→ "← Directory"
 * goes to `/`) for a cold deep-link.
 */
export function deriveDirectoryNav(
  state: DirectoryNavState | null | undefined,
  currentId: number,
  stash: DirectoryStash,
): DirectoryNav {
  const { ids, url } = stash;
  const total = ids.length;
  const index = ids.indexOf(currentId);
  const hasStash = total > 0 && index >= 0;
  const delta = state?.directoryDelta ?? (state?.fromDirectory ? 1 : 0);
  return {
    hasStash,
    ids,
    stashId: state?.stashId,
    delta,
    directoryUrl: url,
    index,
    total,
    prevId: hasStash && index > 0 ? (ids[index - 1] ?? null) : null,
    nextId: hasStash && index < total - 1 ? (ids[index + 1] ?? null) : null,
  };
}

/**
 * The state for a Prev/Next step: the same stash handle at the **same** distance
 * from the Directory, because the step replaces the current history entry instead
 * of pushing a new one (OFC-395). It was `delta + 1` under N45's push model; that
 * increment is what eventually outran the browser's history cap.
 */
export function stepNavState(nav: DirectoryNav): DirectoryNavState {
  return { fromDirectory: true, stashId: nav.stashId, directoryDelta: nav.delta };
}

/**
 * Whether `history.go(-delta)` can actually reach the Directory entry — asked
 * *before* the pop, because `go()` past the start of the stack neither navigates
 * nor throws nor returns anything (OFC-395).
 *
 * The current entry's index is at most `historyLength - 1`, and every entry
 * carries a `delta` no larger than its own index at the time it was created, so
 * `delta > historyLength - 1` means entries have been **pruned** off the old end
 * of the stack and the Directory went with them. Asking the browser is what makes
 * this robust: `historyLength` is `window.history.length`, which the browser
 * itself caps, so we never have to model the cap's value (50 in Chrome today) or
 * notice when it changes.
 *
 * ⚠ **The test is one-sided, not exact: it never rejects a reachable entry, but it
 * can still accept an unreachable one.** `history.length` counts *forward* entries
 * too, so after the user has walked back with the browser's own Back button the
 * current index is strictly below `historyLength - 1` and the bound goes slack.
 * There is no API for the current index (React Router's `history.state.idx` is
 * stamped at push time and is itself stale after a prune), so this is the tightest
 * sound test available. It fails in the safe direction: an over-optimistic accept
 * produces exactly the pre-D169 behaviour — a click that does nothing — never a
 * wrong navigation. Reaching it requires being at the very oldest surviving entry
 * with a stack full of forward entries, which no ordinary use of Book produces.
 *
 * Deliberately *not* the after-the-fact check the ticket first sketched ("see on
 * the next tick whether the location changed"): a history traversal is
 * asynchronous, so a next-tick check can run before a perfectly good pop lands and
 * would double-navigate on the happy path — turning a rare silent failure into a
 * common visible one.
 */
export function directoryEntryIsReachable(delta: number, historyLength: number): boolean {
  return delta > 0 && delta <= historyLength - 1;
}
