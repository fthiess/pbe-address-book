import type { MouseEvent } from "react";

/**
 * The interactive pinned-cell controls — the universal **Star** toggle (§5.6.6,
 * D39) and the manager/admin **Select** checkbox (§5.6.8, D41). Both sit inside a
 * clickable row, so both stop propagation: starring or selecting must never also
 * open the profile (§5.6.7). State is shown by shape **and** fill (and an
 * accessible label / pressed state), never colour alone (D32).
 */

/** Swallow the row's click/navigation so a control action stays just that. */
function stop(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function StarButton({
  starred,
  name,
  onToggle,
}: {
  starred: boolean;
  /** The brother's name, woven into the accessible label for context. */
  name: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={starred}
      aria-label={starred ? `Starred: ${name}. Activate to unstar.` : `Star ${name}.`}
      onClick={(event) => {
        stop(event);
        onToggle();
      }}
      className="flex size-8 items-center justify-center rounded outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <StarIcon filled={starred} />
    </button>
  );
}

/** A gold five-point star — solid when starred, hollow outline when not (D32). */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? "var(--brand-gold)" : "none"}
      stroke={filled ? "var(--brand-gold)" : "currentColor"}
      strokeWidth="1.6"
      strokeLinejoin="round"
      className={filled ? undefined : "text-muted-foreground"}
    >
      <path d="M12 2.6l2.7 5.8 6.3.6-4.8 4.2 1.4 6.2L12 16.9 6.4 19.4l1.4-6.2L3 9l6.3-.6z" />
    </svg>
  );
}

export function SelectCheckbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={label}
      onClick={stop}
      onChange={onToggle}
      className="size-4 cursor-pointer rounded border-input accent-[var(--brand-gold)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}
