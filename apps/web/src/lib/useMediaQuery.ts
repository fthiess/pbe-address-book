import { useEffect, useState } from "react";

/**
 * Track a CSS media query reactively. Used to choose the Directory's *layout by
 * viewport width* (§5.5) — the full grid at `md` and above, stacked cards below
 * — rendering only the active one so a single virtualizer and one idle-prefetch
 * walk run at a time. SSR-safe (returns `false` until mounted), though Book is a
 * pure client SPA.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
