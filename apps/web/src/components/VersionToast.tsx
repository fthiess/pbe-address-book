import { useEffect, useRef, useState } from "react";
import { APP_VERSION, fetchServerVersion, isNewerVersion } from "../lib/version.js";

/** How often an open, focused tab re-checks the deployed build id (frugal — OFC-63). */
const POLL_INTERVAL_MS = 30 * 60 * 1000;

/**
 * The long-lived-tab "new version available" toast (OFC-63). Mounted inside the
 * authenticated shell, it records the build id this tab booted with and polls
 * `/version.json` **frugally** — on window refocus and tab-visibility, plus a
 * generous interval — backing off entirely while the tab is hidden (no bytes, no
 * battery on a backgrounded tab). When the deployed id has moved on it raises one
 * calm, non-blocking toast with a Refresh button; the user chooses when to reload,
 * and a dismiss leaves them be. Once a new version is seen the poll stops — the id
 * only changes on a deploy, so there is nothing more to learn until a reload.
 *
 * Accessibility (D79): the toast is a polite live region (announced on appear, not
 * focus-stealing), both controls are real keyboard-operable buttons at the 44px
 * target size, and the copy is AA-contrast on the card. No motion (calm interface).
 */
export function VersionToast() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Once we know an update is out, stop polling — a ref (not state) so the effect's
  // stable closure can read the latch without re-subscribing its listeners.
  const foundRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const check = async () => {
      // Back off while hidden, and never re-poll once we've found an update.
      if (foundRef.current || document.hidden) {
        return;
      }
      const deployed = await fetchServerVersion(controller.signal);
      if (!cancelled && isNewerVersion(APP_VERSION, deployed)) {
        foundRef.current = true;
        setUpdateAvailable(true);
      }
    };

    const onFocusOrVisible = () => {
      if (!document.hidden) {
        void check();
      }
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    const interval = window.setInterval(() => void check(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      window.clearInterval(interval);
    };
  }, []);

  if (!updateAvailable || dismissed) {
    return null;
  }

  return (
    // `<output>` carries an implicit "status" polite live region (the same pattern as
    // the profile "Saved" toast), so the notice is announced without stealing focus.
    <output className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-card px-4 py-3 text-card-foreground shadow-[var(--shadow-popover-strong)]">
        <span className="text-sm">A new version of Book is available.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="inline-flex size-11 items-center justify-center rounded-lg text-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </output>
  );
}
