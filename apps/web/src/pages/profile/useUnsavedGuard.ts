import { useEffect } from "react";

/**
 * The browser-level half of the unsaved-changes guard (§5.4/§5.7, D43). While an
 * edit has pending changes, a navigation that leaves the SPA entirely — reload,
 * tab close, typing a new URL, an external link — triggers the native "leave
 * site?" prompt.
 *
 * The in-app half (Back, in-SPA links, Cancel) is handled separately by
 * `useBlocker` in `ProfileEdit` (OFC-65), which the data-router migration made
 * available; together they cover every exit from a dirty edit.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers require returnValue to be set for the prompt to show.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
