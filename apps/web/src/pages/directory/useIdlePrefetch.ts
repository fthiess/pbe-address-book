import { useEffect } from "react";
import type { DirectoryProfile } from "../../lib/types.js";
import { thumbnailUrl } from "./thumbnail.js";

/**
 * Idle-time thumbnail prefetch (§5.6.9, D9). The grid lazy-loads the thumbnails
 * near the viewport; this warms the *rest* of the current result set in scroll
 * order during idle time, so scrolling stays smooth without front-loading the
 * initial render. It is affordable — a 96² WEBP is a few KB, and the objects are
 * immutable and indefinitely browser-cacheable (D17/D126), so re-views and new
 * tabs are instant.
 *
 * The walk is **bounded to the current result set and cancelled on any view
 * change** (the effect re-runs when `rows` changes, tearing down the previous
 * idle callback), so a search or filter edit never leaves a stale prefetch
 * running against rows the user has navigated away from. Failures are silent: a
 * warm cache is best-effort, and a missing image simply isn't prefetched.
 */

type IdleHandle = number;

interface IdleWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => IdleHandle;
  cancelIdleCallback?: (handle: IdleHandle) => void;
}

const idle = globalThis as unknown as IdleWindow;

/** Schedule low-priority work, falling back to a timer where rIC is unavailable. */
function whenIdle(callback: () => void): IdleHandle {
  if (typeof idle.requestIdleCallback === "function") {
    return idle.requestIdleCallback(callback, { timeout: 2000 });
  }
  return setTimeout(callback, 200) as unknown as IdleHandle;
}

function cancelIdle(handle: IdleHandle): void {
  if (typeof idle.cancelIdleCallback === "function") {
    idle.cancelIdleCallback(handle);
    return;
  }
  clearTimeout(handle);
}

export function useIdlePrefetch(rows: readonly DirectoryProfile[]): void {
  useEffect(() => {
    // Build the in-scroll-order URL list once per result set; skip records with
    // no thumbnail to load.
    const urls: string[] = [];
    for (const profile of rows) {
      const url = thumbnailUrl(profile);
      if (url) {
        urls.push(url);
      }
    }
    if (urls.length === 0) {
      return;
    }

    let cursor = 0;
    let handle: IdleHandle | null = null;
    let cancelled = false;

    const pump = () => {
      if (cancelled || cursor >= urls.length) {
        return;
      }
      // A handful per idle slice keeps each callback short; the browser dedupes
      // against its cache, so already-loaded thumbnails cost nothing.
      const slice = urls.slice(cursor, cursor + 8);
      cursor += slice.length;
      for (const src of slice) {
        const image = new Image();
        image.decoding = "async";
        image.src = src;
      }
      handle = whenIdle(pump);
    };

    handle = whenIdle(pump);
    return () => {
      cancelled = true;
      if (handle != null) {
        cancelIdle(handle);
      }
    };
  }, [rows]);
}
