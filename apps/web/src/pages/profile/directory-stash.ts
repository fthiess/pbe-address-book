import type { DirectoryNavState } from "./directory-nav.js";

/**
 * The directory prev/next id-list store (Phase 4d, OFC-141 + its live-test
 * follow-up).
 *
 * The Prev/Next feature needs the ordered id-list of the Directory view the user
 * clicked in from. OFC-141 moved that list out of `location.state` (which the
 * browser structure-clones into `history.state` on every push) into this store,
 * keyed by a short `stashId` carried in history state instead.
 *
 * **Lazy write (live-test follow-up):** the list is written **only when the user
 * actually navigates into a profile**, not on every Directory render. An earlier
 * cut stashed inside the grid/cards `useMemo`, so every search / filter / sort
 * keystroke wrote a fresh entry even when no profile was ever opened, churning
 * the whole ring with never-used sets. Now the entry points precompute a
 * `stashId` (via {@link newStashId}) for the current view and only call
 * {@link putDirectoryStash} on the click that leaves for a profile; a Prev/Next
 * step reuses the same `stashId` (no re-write). So searching/filtering/sorting
 * writes nothing, and the store only ever holds sets the user actually navigated
 * from — capped at {@link MAX_STASHES}.
 *
 * Backed by `sessionStorage` so a set survives a same-tab reload (matching the
 * old `history.state` persistence). A bounded, reload-persistent index evicts the
 * oldest so a long session can't accumulate them without limit. All access is
 * `try/catch`-guarded: if `sessionStorage` is unavailable or full, a write is a
 * no-op and a read returns `[]`, so Prev/Next degrade to hidden (the cold
 * deep-link path) rather than throwing.
 */

const KEY_PREFIX = "pbe:dirnav:";
const INDEX_KEY = "pbe:dirnav:index";
/** Retain at most this many recent stashes (one per distinct Directory view actually navigated from). */
const MAX_STASHES = 12;

/** Generate a fresh, unguessable stash id (no storage write — {@link putDirectoryStash} does that). */
export function newStashId(): string {
  // `crypto.randomUUID` is available in every target browser and in jsdom; the
  // fallback keeps a non-crypto environment from throwing.
  try {
    return crypto.randomUUID();
  } catch {
    return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

function readIndex(): string[] {
  try {
    const raw = sessionStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Store an ordered id-list under a (caller-owned) stash id. Idempotent for a given
 * id — re-writing the same `stashId` overwrites its list and moves it to
 * most-recent in the eviction order without adding a duplicate index entry.
 */
export function putDirectoryStash(stashId: string, ids: number[]): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + stashId, JSON.stringify(ids));
    // Dedupe (move-to-most-recent) then bound, evicting the oldest.
    const index = readIndex().filter((existing) => existing !== stashId);
    index.push(stashId);
    while (index.length > MAX_STASHES) {
      const evicted = index.shift();
      if (evicted) {
        sessionStorage.removeItem(KEY_PREFIX + evicted);
      }
    }
    sessionStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // sessionStorage unavailable/full — prev/next silently degrade to hidden.
  }
}

/** Resolve a stash id back to its ordered id-list, or `[]` if absent/evicted/unavailable. */
export function getDirectoryStash(stashId: string | undefined): number[] {
  if (!stashId) {
    return [];
  }
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + stashId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

/**
 * The initial `location.state` for a navigation out of the Directory (first hop):
 * carry only the stash handle at `directoryDelta: 1`. Pure — the id-list itself is
 * written lazily by the entry point's click handler (see {@link putDirectoryStash}).
 */
export function entryNavState(stashId: string): DirectoryNavState {
  return { fromDirectory: true, stashId, directoryDelta: 1 };
}
