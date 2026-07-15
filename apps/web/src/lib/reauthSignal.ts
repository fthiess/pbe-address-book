import { useSyncExternalStore } from "react";

/**
 * The re-auth "re-arm" signal (OFC-236, D109/R18). After the child-window re-auth
 * restores the session mid-lapse, images that failed to load while the cookie was
 * dead ( their `/img/*` fetch 401'd → the silhouette fallback) must reload under the
 * restored session. Rather than have every `<img>` read HTTP status (an element
 * can't) or drive its own re-auth, the session layer bumps this one counter on a
 * successful re-auth and each image resets its failed state and re-fetches.
 *
 * It is a module-level external store (not React context) so a bump re-renders only
 * the subscribed thumbnails — not the whole tree on every session change — and so the
 * image components need no `SessionProvider` in isolation. Mirrors the `useRoster`
 * store shape.
 */

let nonce = 0;
const listeners = new Set<() => void>();

/** Bump the re-arm signal after a successful re-auth, so failed images reload. */
export function bumpReauthSignal(): void {
  nonce += 1;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return nonce;
}

/**
 * Subscribe a component to the re-arm signal. The returned number changes only when
 * a re-auth completes; use it as an effect dependency to reset an image's failed
 * state so it re-fetches under the restored session.
 */
export function useReauthSignal(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Reset the signal — for tests, which need a clean counter per case. */
export function __resetReauthSignal(): void {
  nonce = 0;
}
