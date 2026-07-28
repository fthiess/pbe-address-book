import { useEffect, useSyncExternalStore } from "react";
import { fetchProfiles } from "./api.js";
import type { DirectoryProfile, ProfileRecord } from "./types.js";

/**
 * The single in-memory roster store (Phase 4b-1; unified in Phase 7.5a). Both the
 * Directory and the Profile page subscribe to this one module-level store — the
 * Directory renders the grid from it, and the Profile page's Big-Brother typeahead
 * and **derived Little Brothers** compute over it (PRD §5.7.4; `bigBrotherId` is
 * `public`, so the bulk brother-projection carries every pointer needed to derive
 * the reverse edge). Before 7.5a the Directory kept its own mount-scoped copy and
 * re-downloaded the full ~1 MB payload on every remount; unifying the two copies
 * retires both the double download and the drift between them (ENGINEERING-DESIGN
 * §1.7, N62).
 *
 * Freshness: {@link revalidateRoster} runs on every Directory mount and on tab
 * focus/visibility (7.5b). With data retained it revalidates **in the
 * background** — an app-level conditional read carrying the store's dataset
 * token, answered `304` when nothing changed (re-render from the retained
 * store, no transfer) or `200` + a fresh payload and token (atomic swap). The
 * token and the data live only in this module's heap over a `no-store`
 * response; the browser HTTP cache is never involved (D95/N63). A background
 * failure keeps the retained data silently; `error` is only ever true when
 * there is nothing to show.
 *
 * Because the Little-Brother list is **derived, not stored**, a save that changes a
 * `bigBrotherId` must be reflected back into this cache, or the *other* brother's
 * page (computed from the roster) would still show the pre-save relationships. The
 * store is subscribable (`useSyncExternalStore`) and {@link applyProfileToRoster}
 * patches the saved record in place, so a navigation to the (new or former) Big
 * Brother recomputes against fresh data without a second download.
 */

interface RosterState {
  /** The roster once loaded; `null` before the first fetch lands and again after {@link clearRoster}. */
  profiles: DirectoryProfile[] | null;
  error: boolean;
}

let state: RosterState = { profiles: null, error: false };
let loading = false;
/**
 * The store's clear-generation. `load()` has no AbortController (deliberately —
 * the fetch outlives pages), so this is what stops a response that was in flight
 * when {@link clearRoster} ran from repopulating the just-cleared store: sign-out
 * must actually remove the PII from the heap on a shared machine (D95/OFC-118),
 * and an unfenced late `200` would silently put all of it back. Bumped by every
 * clear; a fetch settles into the store only if no clear happened since it began.
 */
let epoch = 0;
/**
 * The dataset version token from the last fresh bulk read (7.5b) — the value
 * revalidations send as `If-None-Match`. Role-qualified by the server, so it is
 * cleared with the data on {@link clearRoster}: the next viewer on this tab (or
 * this viewer under a different role) must never revalidate against the prior
 * viewer's token. Heap-only, like the data it versions (D95/N63).
 */
let etag: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setState(next: RosterState): void {
  state = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): RosterState {
  return state;
}

function load(): void {
  if (loading) {
    return;
  }
  loading = true;
  // No AbortController: the fetch deliberately outlives any one page — the store
  // is module-lived, so a response arriving after the starting page unmounted
  // still serves the next consumer. The epoch fence below is the boundary that
  // must NOT be outlived: a clearRoster() (sign-out/401) while this fetch is in
  // flight makes its outcome unwanted, whatever it is.
  const startedIn = epoch;
  // Send the token only when there is retained data to re-render from — a `304`
  // against an empty store would leave nothing to show.
  const token = state.profiles !== null ? etag : null;
  fetchProfiles(token)
    .then((result) => {
      if (epoch !== startedIn) {
        return;
      }
      if (result.status === "not-modified") {
        // The retained store is current; nothing to swap and no bytes were sent.
        return;
      }
      etag = result.etag;
      setState({ profiles: result.body.profiles, error: false });
    })
    .catch(() => {
      // With retained data, fail silently and keep showing it — a background
      // refresh that breaks must not blank a working Directory. `error` is only
      // ever true when there is nothing to render instead.
      if (epoch === startedIn && state.profiles === null) {
        setState({ profiles: null, error: true });
      }
    })
    .finally(() => {
      // A stale fetch's settle must not clobber `loading` either: after a clear,
      // a NEW fetch may already own the flag.
      if (epoch === startedIn) {
        loading = false;
      }
    });
}

function ensureLoaded(): void {
  // Retry on any fresh mount when the roster isn't loaded — the earlier
  // `!state.error` guard latched a single transient failure (a scale-to-zero cold
  // 503, a network blip on the flaky slow links this audience skews toward) into a
  // permanent error for the whole session, with no recovery short of a full page
  // reload. Opening another profile now re-attempts the fetch (OFC-114).
  if (state.profiles === null && !loading) {
    load();
  }
}

/**
 * Revalidate the roster (Phase 7.5a): fired on every Directory mount, replacing
 * the Directory's old unconditional remount refetch. Store empty → the ordinary
 * first load (the D119 overlay path). Data retained → a background conditional
 * read (7.5b: `If-None-Match`, usually answered `304`) that swaps in fresh data
 * only when something changed, while the caller renders the retained roster
 * immediately. Deduped against any in-flight fetch.
 */
export function revalidateRoster(): void {
  load();
}

/**
 * Tab-focus revalidation (7.5b, N62): a return to the tab quietly narrows the
 * cross-user staleness window for the price of a `304` round trip. Armed once,
 * from the first mounted consumer — module-lived listeners on a module-lived
 * store, deliberately never removed. Guards: browser only (unit tests run under
 * node), only when the tab is actually visible, and only with retained data —
 * an empty store belongs to the mount path (and firing on empty would hit the
 * API from signed-out tabs).
 */
let focusRevalidationArmed = false;
function armFocusRevalidation(): void {
  if (focusRevalidationArmed || typeof document === "undefined" || typeof window === "undefined") {
    return;
  }
  focusRevalidationArmed = true;
  const onWake = (): void => {
    if (document.visibilityState !== "visible" || state.profiles === null) {
      return;
    }
    load();
  };
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);
}

export type Roster = RosterState;

export function useRoster(): Roster {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    armFocusRevalidation();
    ensureLoaded();
  }, []);
  return snapshot;
}

/**
 * Fold a just-saved record back into the cached roster so the **derived** Little-
 * Brother edge stays correct (a save that re-points a `bigBrotherId` must change
 * the other brother's page too — §5.7.4). Patches the lean roster fields (name,
 * class year, `bigBrotherId`) in place; a no-op until the roster has loaded (a
 * later first load reads the server's already-updated cache anyway).
 */
export function applyProfileToRoster(record: ProfileRecord): void {
  if (state.profiles === null) {
    return;
  }
  const prev = state.profiles.find((p) => p.id === record.id);
  const lean: DirectoryProfile = { ...(prev ?? { id: record.id }) };
  if (record.firstName !== undefined) {
    lean.firstName = record.firstName;
  }
  if (record.lastName !== undefined) {
    lean.lastName = record.lastName;
  }
  if (record.classYear !== undefined) {
    lean.classYear = record.classYear;
  }
  // Always reflect the relationship pointer, including a clear (null/absent → none).
  lean.bigBrotherId = record.bigBrotherId ?? undefined;

  const profiles = prev
    ? state.profiles.map((p) => (p.id === record.id ? lean : p))
    : [...state.profiles, lean];
  setState({ profiles, error: state.error });
}

/**
 * Drop the cached roster from the heap. The roster is the full brother-projected
 * dataset (~1,166 records of real PII), held in a module-level singleton for the
 * tab's lifetime; it must not survive a sign-out on a shared/family machine
 * (real-PII discipline, D95). Called from both signed-out paths — the explicit
 * sign-out and the app-wide mid-session 401 (OFC-118). Emits so any mounted
 * `useRoster` re-renders empty; the next authenticated mount re-fetches.
 */
export function clearRoster(): void {
  epoch += 1; // discard any in-flight fetch's outcome — see the field's comment
  loading = false;
  etag = null; // the token is role-qualified PII-adjacent state; it goes with the data
  setState({ profiles: null, error: false });
}

/** Reset the module store — for tests, which need a fresh fetch per case. */
export function __resetRosterCache(): void {
  epoch += 1;
  state = { profiles: null, error: false };
  loading = false;
  etag = null;
}

/**
 * Read the current store state — for tests only. Unit tests run under the node
 * environment (no React rendering; see vitest.config.ts), so they exercise the
 * module functions directly and observe transitions through this getter.
 */
export function __getRosterState(): RosterState {
  return state;
}
