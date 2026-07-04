import { cn } from "../../lib/utils.js";
import type { DirectoryNav as DirectoryNavModel } from "./directory-nav.js";

/**
 * The Profile-page directory navigation bar (Phase 4d, OFC-67 / N45): the
 * "← Directory" affordance (delta-aware — it pops to the true Directory entry
 * even after a Prev/Next chain) plus Prev / Next through the stashed set and a
 * "12 of 431" position readout. Prev/Next and the readout render only when a
 * Directory set was stashed (i.e. not on a cold deep-link); "← Directory" always
 * shows (it falls back to the Directory home). Shared by {@link ProfileView} and
 * the container's not-found branch so a stale id still gets prev/next — the
 * controls live on the display page only (edit keeps the N33 one-entry model).
 */
export function DirectoryNav({
  nav,
  onBack,
  onPrev,
  onNext,
}: {
  nav: DirectoryNavModel;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-1 py-1 text-[length:var(--text-label)] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true">←</span> Directory
      </button>

      {nav.hasStash && (
        <div className="flex items-center gap-1.5">
          <StepButton
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
  label,
  onClick,
  disabled,
  arrow,
  text,
  arrowSide,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  arrow: string;
  text: string;
  arrowSide: "start" | "end";
}) {
  return (
    <button
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
