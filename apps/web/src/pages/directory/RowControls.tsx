import { Star } from "lucide-react";
import type { MouseEvent } from "react";

/**
 * The interactive pinned-cell controls — the **Star** toggle (§5.6.6, D39) and the
 * **Select** checkbox (§5.6.8, D41), both universal since D175. Both sit inside a
 * clickable row, so both **stop propagation** so starring or selecting never also
 * opens the profile (§5.6.7) — but they must NOT `preventDefault` (that would
 * cancel the checkbox's own toggle). In the grid each control **fills its cell**
 * (`fill`) so the whole cell is a comfortable target (≥24px, WCAG 2.5.8) with no
 * dead padding that could fall through to the row's open-profile click; in the
 * card overlay they keep their intrinsic size. State is shown by shape + fill
 * (and an accessible label / pressed state), never colour alone (D32).
 *
 * ⚠ **`fill` is `absolute inset-0`, NOT `size-full`, and the difference is the
 * whole of OFC-397.** `size-full` sets `height: 100%`, which needs a containing
 * block with a *definite* height to resolve against — and a `<td>` does not supply
 * one: its height is a used value that table layout computes, so the percentage
 * fell back to `auto` and each control was left at its own content height. The
 * cells looked filled (percentage *widths* do resolve, against the column's
 * definite width) while standing 16px tall in a 56px row, so a click a few pixels
 * above or below the glyph missed the control, reached the row, and opened a
 * profile. Absolute positioning sidesteps the rule entirely — `inset-0` resolves
 * against the positioned cell's padding box, whose used height is the row's — so
 * the control cells must stay positioned (`relative`, or the `sticky` a pinned
 * column already carries). The e2e in `row-controls-397.spec.ts` clicks at an
 * explicit inset and asserts the box is ≥24px; a `.click()` on the control itself
 * cannot see this regression, which is exactly how it reached UAT.
 */

/** Keep a control's click from bubbling to the row's open-profile handler. */
function stopRowOpen(event: MouseEvent): void {
  event.stopPropagation();
}

export function StarButton({
  starred,
  name,
  onToggle,
  fill = false,
  prominent = false,
}: {
  starred: boolean;
  /** The brother's name, woven into the accessible label for context. */
  name: string;
  onToggle: () => void;
  /** Fill the parent cell (the grid) vs. keep an intrinsic 32px size (the card). */
  fill?: boolean;
  /**
   * A larger star for the Profile header (OFC-256): the glyph is sized to the
   * class-year type (`--text-h3`, 21px) sitting beside it, in a roomier 40px target
   * — the Directory/card 18px star is too small next to the profile's larger name.
   */
  prominent?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? `Starred: ${name}. Activate to unstar.` : `Star ${name}.`}
      onClick={(event) => {
        stopRowOpen(event);
        onToggle();
      }}
      className={`flex items-center justify-center rounded outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
        fill ? "absolute inset-0" : prominent ? "size-10" : "size-8"
      }`}
    >
      <StarIcon filled={starred} size={prominent ? 22 : 18} />
    </button>
  );
}

/** A gold five-point star — solid when starred, hollow outline when not (D32). */
function StarIcon({ filled, size = 18 }: { filled: boolean; size?: number }) {
  return (
    <Star
      size={size}
      aria-hidden="true"
      strokeWidth={1.6}
      // Brand-gold fill + stroke when starred; hollow with the muted outline when
      // not — colour is never the sole signal, the aria-pressed label carries it.
      fill={filled ? "var(--brand-gold)" : "none"}
      color={filled ? "var(--brand-gold)" : undefined}
      className={filled ? undefined : "text-muted-foreground"}
    />
  );
}

export function SelectCheckbox({
  checked,
  label,
  onToggle,
  fill = false,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  /** Fill the parent cell (the grid) vs. keep an intrinsic 32px size (the card). */
  fill?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the label is only a click-propagation guard around a natively-interactive, keyboard-reachable checkbox — activation and keyboard both go through the <input>; the label just keeps a selection click from opening the row's profile (§5.6.7).
    <label
      className={`flex cursor-pointer items-center justify-center ${
        fill ? "absolute inset-0" : "size-8"
      }`}
      onClick={stopRowOpen}
    >
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={onToggle}
        className="size-4 cursor-pointer rounded border-input accent-[var(--brand-gold)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}
