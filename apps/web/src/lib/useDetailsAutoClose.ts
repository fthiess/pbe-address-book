import { type RefObject, useEffect } from "react";

/**
 * Close a native `<details>` disclosure on an outside click or Escape — the
 * dismiss behaviour every menu/popover is expected to have, which `<details>`
 * does not provide on its own. Escape also returns focus to the summary, so
 * keyboard users aren't stranded. Used by the Directory's Columns picker, its
 * Export menu, the filter panel, and the masthead avatar menu.
 *
 * ⚠ **The element is read at event time, not at mount time** (OFC-403). This hook
 * ran once and bailed out when `ref.current` was null, which was invisible while
 * every caller rendered its `<details>` unconditionally — and then the Export menu
 * arrived, which renders a disabled *button* until there are rows to export. It
 * therefore mounted with a null ref, attached no listeners, and never re-ran: the
 * menu came into existence with neither Escape nor outside-click dismissal, and
 * nothing about it looked wrong. A conditionally-rendered disclosure is the
 * ordinary case, not an exotic one, so the hook now accommodates it.
 */
export function useDetailsAutoClose(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const details = ref.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const details = ref.current;
      if (event.key === "Escape" && details?.open) {
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
