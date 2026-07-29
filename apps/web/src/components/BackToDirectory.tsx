import { Link } from "react-router-dom";

/**
 * The "← Directory" affordance, shared by every page that offers one — the
 * Profile page's {@link DirectoryNav} bar, the Admin panel, and Add Brother.
 * Each of those carried its own copy of the styling until OFC-362, and the
 * copies had already drifted apart (Add Brother's was a different colour and
 * weight); this is the one definition.
 *
 * **It renders as a bordered button, matching the Prev/Next controls exactly**
 * (OFC-362). OFC-198 had matched only the size, weight, and colour and kept the
 * affordance a borderless text link; UAT found that on a phone the result still
 * read as secondary to the buttons beside it, so the border came too. The
 * *semantics* below are unchanged from OFC-145 — only the chrome moved.
 *
 * Two forms, chosen by `onPop`:
 *
 * - **`onPop` given** — there is a history chain to walk back (a Prev/Next chain
 *   on the Profile page, or an entry pushed on the way in from the Directory), so
 *   the control must be a `<button>`: an `href` cannot POP the history stack, and
 *   only a POP restores the Directory's search / filter / sort / scroll.
 * - **`onPop` null** — a cold deep-link with nothing to pop, so the escape hatch
 *   is a real `<Link to="/">`. It works even if the router misfires and reads as
 *   a link to assistive tech (OFC-145).
 */
export function BackToDirectory({
  onPop,
  onActivate,
}: {
  /** Walk the history back to the Directory, or `null` when there is nothing to pop. */
  onPop: (() => void) | null;
  /** Fired on activation in either form — the Profile page's analytics ping. */
  onActivate?: () => void;
}) {
  const content = (
    <>
      <span aria-hidden="true">←</span> Directory
    </>
  );

  return onPop ? (
    <button
      type="button"
      onClick={() => {
        onActivate?.();
        onPop();
      }}
      className={BACK_CLASS}
    >
      {content}
    </button>
  ) : (
    <Link to="/" onClick={() => onActivate?.()} className={BACK_CLASS}>
      {content}
    </Link>
  );
}

/**
 * Matched to `StepButton` (the Prev/Next controls) property for property — border,
 * background, radius, height, padding, type scale, weight, hover, and focus ring —
 * so the three controls on the Profile nav bar read as one set of buttons. Kept
 * beside the component rather than shared with `StepButton`: they are deliberately
 * identical today, but a *link* and a *step control* are free to diverge later, and
 * a shared constant would quietly forbid that.
 */
const BACK_CLASS =
  "inline-flex min-h-[1.75rem] items-center gap-1.5 rounded-[var(--radius-md)] border border-input bg-background px-2.5 py-1 text-[length:var(--text-label)] font-medium text-foreground no-underline outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";
