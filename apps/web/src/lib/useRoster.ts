import { useEffect, useSyncExternalStore } from "react";
import { fetchProfiles } from "./api.js";
import type { DirectoryProfile, ProfileRecord } from "./types.js";

/**
 * The session-cached brotherhood roster (Phase 4b-1). The Profile page's
 * Big-Brother typeahead and its **derived Little Brothers** both need the whole
 * in-memory dataset (PRD §5.7.4) — `bigBrotherId` is `public`, so the bulk
 * brother-projection already carries every pointer needed to derive the reverse
 * edge. It is loaded once and held in a tiny external store so opening one profile
 * after another reuses a single download — the byte-frugal path the 60+, slow-link
 * audience needs (the directory's own bulk read stays separate for now).
 *
 * Because the Little-Brother list is **derived, not stored**, a save that changes a
 * `bigBrotherId` must be reflected back into this cache, or the *other* brother's
 * page (computed from the roster) would still show the pre-save relationships. The
 * store is subscribable (`useSyncExternalStore`) and {@link applyProfileToRoster}
 * patches the saved record in place, so a navigation to the (new or former) Big
 * Brother recomputes against fresh data without a second download.
 */

interface RosterState {
  /** The roster once loaded; `null` while the first fetch is in flight. */
  profiles: DirectoryProfile[] | null;
  error: boolean;
}

let state: RosterState = { profiles: null, error: false };
let loading = false;
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
  fetchProfiles()
    .then((response) => setState({ profiles: response.profiles, error: false }))
    .catch(() => setState({ profiles: state.profiles, error: true }))
    .finally(() => {
      loading = false;
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

export type Roster = RosterState;

export function useRoster(): Roster {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(ensureLoaded, []);
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
 * (real-PII discipline, D95). Called from the sign-out path (OFC-118). Emits so
 * any mounted `useRoster` re-renders empty and, if still authenticated, re-fetches.
 */
export function clearRoster(): void {
  loading = false;
  setState({ profiles: null, error: false });
}

/** Reset the module store — for tests, which need a fresh fetch per case. */
export function __resetRosterCache(): void {
  state = { profiles: null, error: false };
  loading = false;
}
