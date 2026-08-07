import { useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
// A pure, React-free, DOM-free predicate — safe to depend on from a shared
// component even though it lives beside the Profile page's nav model.
import { directoryEntryIsReachable } from "../pages/profile/directory-nav.js";

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
 * - **`onPop` given** — the page was reached from the Directory, so returning is
 *   a *history* operation and the control must be a `<button>`: an `href` cannot
 *   POP the stack, and only a POP restores the Directory's scroll position along
 *   with its search / filter / sort. ⚠ Since D169 the action is **not always a
 *   pop**: when the Directory's history entry has been pruned out of the session
 *   history there is nothing to pop to, and {@link useDirectoryReturn} rebuilds
 *   the view by navigating to its URL instead — which recovers search/filter/sort
 *   but not scroll. The control stays a `<button>` regardless, because
 *   reachability is a property of the history stack at *click* time and cannot be
 *   known when the element is rendered.
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

/**
 * The **action** behind "← Directory", shared by all three pages that offer it
 * (D169). Walk `delta` entries back to the Directory when that entry is still in
 * the session history; otherwise rebuild the view by navigating to
 * `directoryUrl`, falling back to a clean Directory when none was stashed.
 *
 * The pre-check exists because `history.go()` **cannot report failure** — asking
 * for an entry that has been pruned off the old end of the stack navigates
 * nowhere, throws nothing and returns nothing, which is exactly how OFC-395
 * reached UAT as a button that did visibly nothing.
 *
 * ⚠ **This lives here, beside the control, for the reason N149 collapsed the
 * three copies of the control itself: they drift.** OFC-362 found the Profile,
 * Admin and Add Brother copies had already diverged on styling; D169 found the
 * same three carrying three copies of the pop. A page that renders
 * {@link BackToDirectory} should get its `onPop` from this hook rather than
 * writing `() => navigate(-1)` again.
 *
 * `delta` 0 (a cold deep-link) is *not* reachable by definition, so this returns
 * the clean-Directory navigation — which is why the Profile page can use the same
 * callback for its post-delete return, where there may be nothing to pop.
 */
export function useDirectoryReturn(delta: number, directoryUrl = ""): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    if (directoryEntryIsReachable(delta, window.history.length)) {
      navigate(-delta);
    } else {
      navigate(directoryUrl || "/");
    }
  }, [delta, directoryUrl, navigate]);
}
