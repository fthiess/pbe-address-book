import { useEffect, useRef } from "react";
import { BackToDirectory } from "../../components/BackToDirectory.js";
import { trackDirectoryLinkClicked } from "../../lib/analytics.js";
import { cn } from "../../lib/utils.js";
import type { DirectoryNav as DirectoryNavModel, StepDirection } from "./directory-nav.js";

/**
 * The Profile-page directory navigation bar (Phase 4d, OFC-67 / N45): the
 * "← Directory" affordance (delta-aware — it returns to the true Directory view
 * however the user reached this brother) plus Prev / Next through the stashed set
 * and a "12 of 431" position readout. Stepping **replaces** the current history
 * entry rather than pushing one, so a walk of any length stays one hop from the
 * Directory (OFC-395 — see `directory-nav.ts` for why that matters). The trade is
 * that the browser's Back button leaves the walk entirely instead of retracing it;
 * Prev is the affordance for stepping back through the set.
 *
 * Prev/Next and the readout render only when a
 * Directory set was stashed (i.e. not on a cold deep-link); "← Directory" always
 * shows. Shared by {@link ProfileView} and the container's not-found branch so a
 * stale id still gets prev/next — the controls live on the display page only
 * (edit keeps the N33 one-entry model).
 *
 * "← Directory" is the shared {@link BackToDirectory} control, which picks its
 * own form from `onPop`: a real `<Link to="/">` when there is nothing to pop (a
 * cold deep-link, `delta === 0`), a `<button>` when there is a chain (`delta > 0`),
 * since an `href` cannot walk the history stack back to the true Directory entry
 * (OFC-145).
 *
 * Stepping via Prev/Next remounts this whole bar (the container flips to a
 * loading state on the id change), which would drop keyboard focus to `<body>`.
 * When the container hands us a pending step direction (`autoFocusStep`), the
 * freshly-mounted bar re-focuses the matching button so a keyboard user can hold
 * Enter to keep stepping; at the end of the set (that button disabled) it falls
 * back to the opposite control (OFC-144).
 */
export function DirectoryNav({
  nav,
  onBack,
  onPrev,
  onNext,
  autoFocusStep,
  onStepFocused,
}: {
  nav: DirectoryNavModel;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  autoFocusStep: StepDirection | null;
  onStepFocused: () => void;
}) {
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Mount-only: this fires when the bar is freshly *remounted* after a Prev/Next
  // step (the container's loading→ready cycle destroys and rebuilds it). It must
  // NOT be keyed on `autoFocusStep`, or it would also run on the transient
  // re-render that happens *before* the loading unmount (new `directoryNav`, old
  // record still shown) and consume the one-shot intent too early — leaving the
  // real remount with nothing to focus. On mount we read the still-unconsumed
  // intent, re-focus the pressed control (or the opposite one if it's disabled at
  // an end of the set, so focus never lands on <body>), then consume it (OFC-144).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only — see comment; the intent is a one-shot ref-backed signal, not reactive state.
  useEffect(() => {
    if (!autoFocusStep) {
      return;
    }
    const pressed = autoFocusStep === "next" ? nextRef.current : prevRef.current;
    const opposite = autoFocusStep === "next" ? prevRef.current : nextRef.current;
    const target = pressed && !pressed.disabled ? pressed : opposite;
    target?.focus();
    onStepFocused();
  }, []);

  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <BackToDirectory
        onPop={nav.delta > 0 ? onBack : null}
        onActivate={trackDirectoryLinkClicked}
      />

      {nav.hasStash && (
        <div className="flex items-center gap-1.5">
          <StepButton
            ref={prevRef}
            label="Previous brother"
            onClick={onPrev}
            disabled={nav.prevId === null}
            arrow="‹"
            text="Prev"
            arrowSide="start"
          />
          {/* Position readout (§5.6.9 style). Not a live region — it changes on a
              full page navigation, which is announced by the profile heading. */}
          <span className="min-w-[4.5rem] text-center text-[length:var(--text-label)] tabular-nums text-muted-foreground">
            {nav.index + 1} of {nav.total}
          </span>
          <StepButton
            ref={nextRef}
            label="Next brother"
            onClick={onNext}
            disabled={nav.nextId === null}
            arrow="›"
            text="Next"
            arrowSide="end"
          />
        </div>
      )}
    </div>
  );
}

/** One Prev/Next control: ≥24 px target, disabled (removed from tab order) at the ends of the set. */
function StepButton({
  ref,
  label,
  onClick,
  disabled,
  arrow,
  text,
  arrowSide,
}: {
  ref: React.Ref<HTMLButtonElement>;
  label: string;
  onClick: () => void;
  disabled: boolean;
  arrow: string;
  text: string;
  arrowSide: "start" | "end";
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-[1.75rem] items-center gap-1 rounded-[var(--radius-md)] border border-input bg-background px-2.5 py-1 text-[length:var(--text-label)] font-medium outline-none",
        "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-background",
      )}
    >
      {arrowSide === "start" && <span aria-hidden="true">{arrow}</span>}
      <span aria-hidden="true">{text}</span>
      {arrowSide === "end" && <span aria-hidden="true">{arrow}</span>}
    </button>
  );
}
