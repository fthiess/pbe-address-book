import { useEffect, useState } from "react";

/**
 * Returns true only once `active` has stayed true past `delayMs` — the
 * threshold gate behind the cold-start loading overlay (D119). A fast response
 * (the warm path) flips `active` back to false before the timer fires, so the
 * overlay never flashes; only a genuinely slow wake-up shows it.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return shown;
}
