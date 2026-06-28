import { useCallback, useEffect, useState } from "react";

/**
 * A boolean view flag held in **History-API state, not the URL** — the same
 * mechanism `useScrollRestoration` uses (merging into `history.state` so React
 * Router's own keys survive). It is the right home for view state that must
 * follow the back button but **must never travel in a shared link**: the
 * Directory's "Starred only" toggle (D39/D31), since stars are per-user and a
 * shared URL must not impose the sender's stars on the recipient.
 *
 * Read on mount and on `popstate` (so back/forward restores the flag for the
 * entry being shown); written by merging into the current entry's state. A new
 * history entry created elsewhere (e.g. a sort change) starts without the key,
 * which is harmless: the in-memory value still drives the view, and Back to an
 * entry that carried the flag restores it.
 */
function readFlag(key: string): boolean {
  if (typeof history === "undefined") {
    return false;
  }
  return (history.state as Record<string, unknown> | null)?.[key] === true;
}

function writeFlag(key: string, value: boolean): void {
  if (typeof history === "undefined") {
    return;
  }
  const current = (history.state as Record<string, unknown> | null) ?? {};
  try {
    history.replaceState({ ...current, [key]: value }, "");
  } catch {
    // Some environments forbid replaceState (opaque origins); the flag then
    // simply doesn't persist across navigation, which is non-fatal.
  }
}

export function useHistoryFlag(key: string): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => readFlag(key));

  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      writeFlag(key, next);
    },
    [key],
  );

  useEffect(() => {
    const onPopState = () => setValue(readFlag(key));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [key]);

  return [value, set];
}
