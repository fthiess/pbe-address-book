import { useEffect, useRef } from "react";
import { useLocation, useMatches } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import { identifyMember, trackPageView, trackSearchPerformed } from "./analytics.js";

/**
 * How long the query must stop changing before a search counts as "performed".
 * Without it, typing "smith" would report five searches; the interesting event is
 * the one the brother stopped on.
 */
const SEARCH_SETTLE_MS = 1000;

/**
 * The route-pattern label an analytics page view reports, hung on each route's
 * `handle` in App.tsx. Declaring it per route — rather than deriving a pattern from
 * `useLocation().pathname` with a regex — is what makes it *structurally*
 * impossible to leak a record id into the event stream (P6): there is no code path
 * from a URL to an event property at all.
 */
export interface AnalyticsHandle {
  analyticsRoute: string;
}

function hasAnalyticsRoute(handle: unknown): handle is AnalyticsHandle {
  return (
    typeof handle === "object" &&
    handle !== null &&
    typeof (handle as AnalyticsHandle).analyticsRoute === "string"
  );
}

/**
 * Identify the signed-in brother and report route-pattern page views (D137/D138).
 *
 * Mounted once, in `RootLayout` — inside the router (it reads route matches) and
 * inside `SessionProvider` (it reads the session). Both effects are no-ops until a
 * session is authenticated: Book is a members-only tool, and tracking the
 * pre-auth screens would file the sign-in page under the `/` pattern, which is
 * both noise and a small lie. `identify` is declared first so it runs before the
 * first page view of a session — though the ordering is a nicety rather than a
 * requirement, since Simplified ID Merge re-attributes a device's earlier
 * anonymous events once `identify()` lands (N123).
 */
export function useAnalytics(): void {
  const { state } = useSession();
  const matches = useMatches();
  const location = useLocation();

  const me = state.status === "authenticated" ? state.me : null;

  useEffect(() => {
    if (!me) {
      return;
    }
    // Gated on the session, NOT on `me.profile`. Everything identify needs —
    // `profileId`, `realRole`, `ghostMemberUuid` — is top-level on `Me`; `profile`
    // is separately `null` whenever the caller's own record isn't cache-resident
    // (apps/api/src/routes/auth.ts). Gating on it would silently drop analytics
    // for a live, fully-valid session for reasons unrelated to identity.
    //
    // **`realRole`, never `role`.** `role` is the *effective* role — the "View as"
    // projection the UI gates on (N31) — while this writes a durable Mixpanel
    // person property. `viewAs` hard-reloads, which clears the identify latch, so
    // passing `role` would rewrite an admin's person profile to `Role: "brother"`
    // the moment he inspected the brother view, and leave it there. That destroys
    // the admin-vs-brother segmentation D88 kept the property for, and it is the
    // same bug class as OFC-263/N104 (impersonation writing through to persisted,
    // identity-keyed state).
    identifyMember(me.ghostMemberUuid, me.profileId, me.realRole);
  }, [me]);

  // Dedupe on the history entry's key, not on the pattern: navigating from one
  // brother to another is two page views of the same pattern and must count twice,
  // while a re-render (or StrictMode's double effect invocation in dev) is neither.
  // The key is only ever compared — never sent.
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!me) {
      // Forget the last entry on the way out, so the *next* session's first page
      // view isn't swallowed by a key left over from the previous one (the tab
      // survives a sign-out, and the sign-in screen can return to the same route).
      lastKey.current = null;
      return;
    }
    const pattern = matches.findLast((match) => hasAnalyticsRoute(match.handle))?.handle as
      | AnalyticsHandle
      | undefined;
    if (!pattern || lastKey.current === location.key) {
      return;
    }
    lastKey.current = location.key;
    trackPageView(pattern.analyticsRoute);
  }, [me, matches, location.key]);
}

/**
 * Report the Directory's "Search Performed" event once the brother stops typing
 * and the name-search worker has settled (D138's one proof-of-life feature event).
 *
 * The query text is held in a ref **only to avoid reporting the same search
 * twice** — it is compared, never sent. What travels is a bucketed count of
 * name-search matches (see `trackSearchPerformed`), which answers the question the
 * event exists for: does search find people, or come back empty?
 *
 * Three ways this measured the wrong thing in its first draft, all caught in review
 * (N125) and all biasing the **same** direction — toward a falsely empty-looking
 * search:
 *
 *  - `datasetReady` gates the whole hook. On a `?q=…` deep link the worker settles
 *    against an *empty* index in milliseconds, long before the roster arrives on a
 *    slow link, so without this the event reported "0 matches" and the dedupe latch
 *    then suppressed the corrected one forever.
 *  - The count is the name-search match set, not the rows on screen. Filters and
 *    the deceased default narrow the view further (D36/D38/D39), and folding those
 *    in would report an empty *search* for a search that worked and a filter that
 *    hid the results.
 *  - The pending report is **flushed on unmount**. Clicking a result unmounts the
 *    Directory, which used to cancel the timer — so precisely the searches that
 *    succeeded went unreported, while an empty result set (nothing to click) always
 *    sat out the full second and got counted.
 */
export function useSearchTracking(
  query: string,
  matchCount: number,
  settled: boolean,
  datasetReady: boolean,
): void {
  const lastReported = useRef<string | null>(null);
  // The report that is armed but not yet sent, readable by the unmount flush.
  const pending = useRef<{ query: string; count: number } | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!datasetReady || trimmed === "" || !settled || lastReported.current === trimmed) {
      return;
    }
    pending.current = { query: trimmed, count: matchCount };
    const timer = window.setTimeout(() => {
      lastReported.current = trimmed;
      pending.current = null;
      trackSearchPerformed(matchCount);
    }, SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [query, matchCount, settled, datasetReady]);

  // Unmount only (empty deps), so this fires when the brother leaves the Directory
  // — typically by clicking a search result — and not on every dependency change.
  useEffect(() => {
    return () => {
      const armed = pending.current;
      if (armed && lastReported.current !== armed.query) {
        lastReported.current = armed.query;
        pending.current = null;
        trackSearchPerformed(armed.count);
      }
    };
  }, []);
}
