import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Save and restore the Directory's scroll position across navigation — a firm
 * requirement (D31/§5.4): paging through several brothers and pressing Back must
 * land the reader where they were, not at the top. Browsers do not restore the
 * scroll of a *virtualized* list on their own (only the near-viewport rows exist
 * in the DOM), so we persist the scroll offset ourselves.
 *
 * The offset is kept in **History API state** (D31), namespaced by the history
 * entry's **stable `location.key`** (not the URL search string), so it travels
 * with the history entry but never leaks into a shared link. Keying by the entry
 * key — rather than the search string — is deliberate (4a-3): under the data
 * router the URL's query params (a sort, the column-lens `?cols=` mirror) are
 * written by nuqs *after* mount, so a search-string key saved a forward offset
 * under the not-yet-updated key while the back-navigation restored under the
 * browser-restored full URL — a mismatch that silently lost the scroll. The
 * entry key is identical on save and on the return POP regardless of param
 * timing. We merge into `history.state` rather than replace it, so React Router's
 * own navigation state is preserved. Restoration runs once, after the list is
 * ready to measure; saving runs throttled to animation frames.
 */

const STATE_KEY = "directoryScroll";

type ScrollState = Record<string, number>;

/** Read the saved offset for a view from the current history entry, if any. */
function readOffset(viewKey: string): number | null {
  if (typeof history === "undefined") {
    return null;
  }
  const bag = (history.state as { [STATE_KEY]?: ScrollState } | null)?.[STATE_KEY];
  const value = bag?.[viewKey];
  return typeof value === "number" ? value : null;
}

/** Merge a view's offset into the current history entry without disturbing other state. */
function writeOffset(viewKey: string, offset: number): void {
  if (typeof history === "undefined") {
    return;
  }
  const current = (history.state as Record<string, unknown> | null) ?? {};
  const bag: ScrollState = { ...(current[STATE_KEY] as ScrollState | undefined) };
  bag[viewKey] = offset;
  try {
    history.replaceState({ ...current, [STATE_KEY]: bag }, "");
  } catch {
    // Some environments forbid replaceState (e.g. opaque origins) — restoration
    // then simply degrades to starting at the top, which is non-fatal.
  }
}

/**
 * Wire scroll save/restore onto a scroll container.
 * @param scrollRef the scrollable element (the grid/card viewport).
 * @param viewKey   the active view identity (the history-entry `location.key`).
 * @param ready     true once the row set is **final and measurable** — rows are
 *                  present AND any async result (the Name-Search worker) has
 *                  settled. Restoring before the set is final would clamp the
 *                  offset against an interim, shorter list (the worker only ever
 *                  *grows* the match), and the once-per-view guard would then keep
 *                  it stuck there — the search-then-Back regression (4a-3).
 */
export function useScrollRestoration(
  scrollRef: RefObject<HTMLElement | null>,
  viewKey: string,
  ready: boolean,
): void {
  // Restore at most once per (view, mount): a later in-place view change scrolls
  // to top naturally and should not be yanked back to a stale offset.
  const restoredFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!ready || !element || restoredFor.current === viewKey) {
      return;
    }
    const saved = readOffset(viewKey);
    if (saved != null) {
      element.scrollTop = saved;
    }
    restoredFor.current = viewKey;
  }, [ready, viewKey, scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    let frame = 0;
    const onScroll = () => {
      // Only record once this view has been restored. A transient scroll while
      // the list is still settling (the worker growing the row set, the
      // virtualizer sizing) must not overwrite the saved offset before it has
      // been applied — otherwise the restore reads back the clobbered value.
      if (restoredFor.current !== viewKey) {
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => writeOffset(viewKey, element.scrollTop));
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [viewKey, scrollRef]);
}
