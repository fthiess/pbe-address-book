import type { FontScale } from "../lib/fontScale.js";
import { cn } from "../lib/utils.js";
import { useFontSize } from "./FontSizeProvider.js";

/**
 * The masthead font-size control (PRD §5.3): a 3-option segmented toggle —
 * Normal / Large / Larger — that scales the whole rem-sized UI for readability.
 * It sits beside the theme toggle and mirrors its shape; the active step is
 * `aria-pressed`. The three "A" glyphs grow left-to-right to signal the effect,
 * but the letter alone is ambiguous to assistive tech, so each button carries a
 * descriptive accessible name.
 */
const OPTIONS: { scale: FontScale; label: string; glyph: string }[] = [
  { scale: "normal", label: "Normal text size", glyph: "text-[11px]" },
  { scale: "large", label: "Large text size", glyph: "text-[14px]" },
  { scale: "larger", label: "Larger text size", glyph: "text-[17px]" },
];

export function FontSizeToggle() {
  const { scale, setScale } = useFontSize();
  return (
    <fieldset className="m-0 inline-flex items-center gap-0.5 rounded-full border border-border bg-secondary p-0.5">
      <legend className="sr-only">Text size</legend>
      {OPTIONS.map((option) => {
        const active = scale === option.scale;
        return (
          <button
            key={option.scale}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            onClick={() => setScale(option.scale)}
            className={cn(
              // ≥24px target (WCAG 2.5.8); active option gets the raised surface.
              "grid size-7 place-items-center rounded-full font-semibold leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span aria-hidden="true" className={option.glyph}>
              A
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}
