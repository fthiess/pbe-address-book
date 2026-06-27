import { type RefObject, useEffect } from "react";

/**
 * Close a native `<details>` disclosure on an outside click or Escape — the
 * dismiss behaviour every menu/popover is expected to have, which `<details>`
 * does not provide on its own. Escape also returns focus to the summary, so
 * keyboard users aren't stranded. Used by the Directory's Columns picker and the
 * masthead avatar menu.
 */
export function useDetailsAutoClose(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const details = ref.current;
    if (!details) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (details.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.open) {
        details.open = false;
        details.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref]);
}
