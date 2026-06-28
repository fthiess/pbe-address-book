import { useCallback, useRef, useState } from "react";
import { addStar as apiAddStar, removeStar as apiRemoveStar } from "../../lib/api.js";

/**
 * The viewer's personal star set, with **optimistic** toggling (D39, PRD §5.6.6).
 * Clicking a star flips it immediately while the `PUT`/`DELETE /api/me/stars/{id}`
 * is in flight; a failed write **reverts** the flip. The set seeds from the
 * caller's own `/api/me` stars (delivered with the session) and is the source of
 * truth for the Star column and the "Starred only" filter thereafter.
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

export function useStars(initial: readonly number[]): Stars {
  const [stars, setStars] = useState<Set<number>>(() => new Set(initial));
  const starsRef = useRef(stars);
  starsRef.current = stars;

  const isStarred = useCallback((id: number) => stars.has(id), [stars]);

  const toggle = useCallback((id: number) => {
    const willStar = !starsRef.current.has(id);
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
    write.catch(() => flip(!willStar)); // revert on failure
  }, []);

  return { isStarred, toggle, set: stars };
}
