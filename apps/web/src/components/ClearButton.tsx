import { X } from "lucide-react";

/**
 * The shared "×" clear control used by the Name Search box and every filter
 * field, so a control with the same function looks identical everywhere. It
 * replaces the browser-native `type="search"` clear (which we suppress in CSS),
 * giving one consistent, keyboard-focusable, theme-aware affordance.
 */
export function ClearButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Clear ${label}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className="flex size-6 items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X size={14} strokeWidth={1.6} aria-hidden="true" />
    </button>
  );
}
