import { useCallback, useMemo, useRef, useState } from "react";
import { trackBrotherStarred, trackBrotherUnstarred } from "../../lib/analytics.js";
import { addStar as apiAddStar, removeStar as apiRemoveStar } from "../../lib/api.js";

/**
 * The viewer's personal star set, with **optimistic** toggling (D39, PRD §5.6.6).
 * Clicking a star flips it immediately while the `PUT`/`DELETE /api/me/stars/{id}`
 * is in flight; on success the set is **reconciled to the server's authoritative
 * list** (the endpoints return the recomputed `number[]`), and a failed write
 * **reverts** the flip. The set seeds from the caller's own `/api/me` stars
 * (delivered with the session) and is the source of truth for the Star column,
 * the "Starred only" filter, and CSV export thereafter.
 *
 * Adopting the returned list (rather than trusting the local flip alone) keeps
 * this tab from drifting when another tab or an earlier session changed the list,
 * and settles the optimistic state on the server's truth (OFC-103). A per-toggle
 * generation guard drops a stale in-flight response so it can't stomp a newer
 * toggle the user has since made.
 *
 * The toggle reads the *current* membership from a ref (not a closed-over value),
 * so rapid clicks across rows never act on a stale snapshot, and the async write
 * lives outside the state updater so React's double-invoked updaters (StrictMode)
 * can't fire it twice.
 */
export interface Stars {
  /** Whether brother `id` is currently starred (optimistic view). */
  isStarred: (id: number) => boolean;
  /** Toggle brother `id`, optimistically, reverting on a failed write. */
  toggle: (id: number) => void;
  /** The current starred set — for the "Starred only" filter. */
  set: ReadonlySet<number>;
}

/**
 * The optimistic star-set implementation hook. Hosted once by {@link StarsProvider}
 * (mounted on the authenticated shell) so the Directory and the Profile page share
 * one in-session set — a star toggled on a Profile reflects on the Directory, and
 * vice versa, without a reload (OFC-256). Components consume it through the
 * provider's `useStars()`, not by calling this directly.
 */
export function useStarsState(initial: readonly number[]): Stars {
  const [stars, setStars] = useState<Set<number>>(() => new Set(initial));
  const starsRef = useRef(stars);
  starsRef.current = stars;

  // Monotonic toggle generation: only the latest toggle's settled response is
  // honored, so a slow older request (success or failure) can't stomp the state a
  // newer toggle has since established (OFC-103, the revert-race).
  const genRef = useRef(0);

  const isStarred = useCallback((id: number) => stars.has(id), [stars]);

  const toggle = useCallback((id: number) => {
    const willStar = !starsRef.current.has(id);
    // Count the star/un-star (7a-4; Forrest's OFC-296 note) on the intent, at the
    // same level as the write so React's double-invoked state updater can't fire it
    // twice. **No id** — that a star happened is the signal, never *whom* (P6).
    if (willStar) {
      trackBrotherStarred();
    } else {
      trackBrotherUnstarred();
    }
    const gen = ++genRef.current;
    const flip = (add: boolean) =>
      setStars((prev) => {
        const next = new Set(prev);
        if (add) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });

    flip(willStar); // optimistic
    const write = willStar ? apiAddStar(id) : apiRemoveStar(id);
    write.then(
      // Reconcile to the server's authoritative list so this tab never drifts
      // from a change made elsewhere; ignore a stale response from an older toggle.
      (serverStars) => {
        if (gen === genRef.current) {
          setStars(new Set(serverStars));
        }
      },
      // Revert the optimistic flip on failure — but only if no newer toggle has
      // superseded this one (else we'd undo the newer action).
      () => {
        if (gen === genRef.current) {
          flip(!willStar);
        }
      },
    );
  }, []);

  // Memoized so the value identity changes only when the set does. As a context
  // value (StarsProvider) a fresh object each render would re-render every star
  // consumer — the whole virtualized grid — on any unrelated shell re-render
  // (a banner poll, an own-headshot update). Mirrors SelectionContext's memo.
  return useMemo(() => ({ isStarred, toggle, set: stars }), [isStarred, toggle, stars]);
}
