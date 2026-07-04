import type { DirectoryNavState } from "./directory-nav.js";

/**
 * The directory prev/next id-list store (Phase 4d follow-up, OFC-141).
 *
 * The Prev/Next feature needs the ordered id-list of the Directory view the user
 * clicked in from. The first cut stashed that whole array *inside* React Router's
 * `location.state`, which the browser structure-clones into `history.state` on
 * **every** push — so a long Prev/Next walk held N separate copies of the full
 * ~1,200-id array in the history stack. Instead we stash the array **once** here,
 * keyed by a short id, and carry only that `stashId` (+ the delta) in history
 * state — a few bytes per entry, and one shared copy of the list.
 *
 * Backed by `sessionStorage` so the list survives a same-tab reload (matching the
 * old `history.state` persistence). A small bounded index evicts the oldest
 * stashes so a long session can't accumulate them without limit; the index lives
 * in `sessionStorage` too, so the bound holds across reloads. All access is
 * wrapped defensively: if `sessionStorage` is unavailable or full, a write is a
 * no-op and a read returns `[]`, so Prev/Next degrade to hidden (the same
 * graceful path as a cold deep-link) rather than throwing.
 */

const KEY_PREFIX = "pbe:dirnav:";
const INDEX_KEY = "pbe:dirnav:index";
/** Retain at most this many recent stashes (one per distinct Directory view visited). */
const MAX_STASHES = 24;

function newStashId(): string {
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

/** Store an ordered id-list and return its stash id (or `undefined` if storage is unavailable). */
export function putDirectoryStash(ids: number[]): string | undefined {
  const stashId = newStashId();
  try {
    sessionStorage.setItem(KEY_PREFIX + stashId, JSON.stringify(ids));
    const index = readIndex();
    index.push(stashId);
    while (index.length > MAX_STASHES) {
      const evicted = index.shift();
      if (evicted) {
        sessionStorage.removeItem(KEY_PREFIX + evicted);
      }
    }
    sessionStorage.setItem(INDEX_KEY, JSON.stringify(index));
    return stashId;
  } catch {
    return undefined;
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
 * stash the ordered id-list once and carry only its handle at `directoryDelta: 1`.
 */
export function entryNavState(ids: number[]): DirectoryNavState {
  return { fromDirectory: true, stashId: putDirectoryStash(ids), directoryDelta: 1 };
}
