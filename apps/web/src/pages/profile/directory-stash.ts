import type { DirectoryNavState, DirectoryStash } from "./directory-nav.js";

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
 * no-op and a read returns an empty stash, so Prev/Next degrade to hidden (the
 * cold deep-link path) rather than throwing.
 *
 * **Each entry also records the Directory's URL** (OFC-395), so "← Directory" can
 * rebuild the view when its history entry has been pruned out of the session
 * history and there is nothing left to pop back to. Entries written before that
 * change — a tab left open across a deploy — are bare id arrays, and
 * {@link getDirectoryStash} still reads them (with no URL, so the fallback is the
 * plain Directory).
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
 * The Directory URL to stash alongside an id-list: `pathname + search`, read from
 * the live location. Called from the click handler that leaves for a profile, so
 * the browser is still *on* the Directory and this is exactly the view being left
 * — which is why it is read here rather than threaded down from a `useLocation`
 * the grid and cards don't otherwise need. Returns `""` outside a browser (the
 * unit tests run DOM-free), which degrades the fallback to the plain Directory.
 */
export function currentDirectoryUrl(): string {
  try {
    return window.location.pathname + window.location.search;
  } catch {
    return "";
  }
}

/**
 * Store an ordered id-list, and the URL of the Directory view it came from, under a
 * (caller-owned) stash id. Idempotent for a given id — re-writing the same
 * `stashId` overwrites its entry and moves it to most-recent in the eviction order
 * without adding a duplicate index entry.
 */
export function putDirectoryStash(stashId: string, ids: number[], url: string): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + stashId, JSON.stringify({ ids, url }));
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

/**
 * Drop every stored stash (and the index). Called when the Directory is shown
 * (see `Directory.tsx`): once the user is back on the Directory, any prev/next
 * stash is for a profile they've left, and the next click-through regenerates one
 * — so keeping them is pure waste. Reaching a profile some other way (a
 * little-brother link, a typed URL) carries no stash handle and shows no
 * prev/next anyway, so nothing of value is lost. The only forgone nicety is
 * Forward-restoring prev/next onto a profile you'd Back'd out of — an acceptable
 * trade for a store that self-empties.
 */
export function clearDirectoryStashes(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      // KEY_PREFIX also prefixes INDEX_KEY, so this removes the index too.
      if (key?.startsWith(KEY_PREFIX)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage unavailable — nothing to clear.
  }
}

/** An absent, evicted or unreadable stash — prev/next degrade to hidden, the fallback to `/`. */
const EMPTY_STASH: DirectoryStash = { ids: [], url: "" };

/**
 * Resolve a stash id back to its id-list and Directory URL, or an empty stash if
 * absent / evicted / unavailable. A bare array is a pre-OFC-395 entry still in
 * `sessionStorage` from before a deploy, and reads as its id-list with no URL.
 */
export function getDirectoryStash(stashId: string | undefined): DirectoryStash {
  if (!stashId) {
    return EMPTY_STASH;
  }
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + stashId);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      return { ids: parsed as number[], url: "" };
    }
    if (parsed && typeof parsed === "object") {
      const { ids, url } = parsed as { ids?: unknown; url?: unknown };
      return {
        ids: Array.isArray(ids) ? (ids as number[]) : [],
        url: typeof url === "string" ? url : "",
      };
    }
    return EMPTY_STASH;
  } catch {
    return EMPTY_STASH;
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
