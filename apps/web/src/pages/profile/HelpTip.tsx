import { useRef } from "react";
import { useDetailsAutoClose } from "../../lib/useDetailsAutoClose.js";

/**
 * The `?` toggle-tip (§5.9; COMPONENTS.md "? Help popover"). A click-toggle
 * disclosure — built on a native `<details>` so it is keyboard- and
 * screen-reader-operable by construction (the same baseline-not-Radix choice the
 * Directory's Columns picker made) — with outside-click / Escape dismissal. On
 * the privacy switches it carries the **counterfactual** consequence (D113): the
 * one-tap-away "what flips if you change this."
 */
export function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsAutoClose(ref);

  return (
    <details ref={ref} className="relative inline-flex">
      <summary
        aria-label={label}
        className="grid size-[22px] cursor-pointer list-none place-items-center rounded-full border-[1.5px] border-[var(--track)] text-[12px] font-bold text-muted-foreground outline-none open:border-primary open:bg-[var(--chip-teal-bg)] open:text-[var(--primary-emphasis)] focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden="true">?</span>
      </summary>
      <div
        role="note"
        className="absolute right-0 top-7 z-30 w-[280px] max-w-[80vw] rounded-xl border border-border bg-popover p-3.5 text-[length:var(--text-body-sm)] leading-relaxed text-popover-foreground shadow-[var(--shadow-popover)]"
      >
        {children}
      </div>
    </details>
  );
}
