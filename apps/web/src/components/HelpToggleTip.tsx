import * as Popover from "@radix-ui/react-popover";
import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { trackHelpOpened } from "../lib/analytics.js";

/**
 * The `?` toggle-tip (PRD §5.9; CODING-PROJECT-PLAN §Phase 6) — the app's one
 * above-baseline help affordance, wired in Phase 6b. A click/tap-toggle disclosure
 * built on Radix Popover (the headless-library landing from 4b-1, N36) with the
 * Lucide `CircleHelp` glyph (6a): Radix supplies keyboard operability, focus
 * management, and Escape / outside-click dismissal, and the trigger carries an
 * accessible name naming the control it explains. It replaces the interim
 * native-`<details>` `HelpTip`.
 *
 * A toggle-tip, not a hover tooltip: it opens on click/tap (never hover), so it
 * works on touch and never depends on a pointer the 60+ audience may not hover
 * with. The 24px trigger meets the WCAG 2.2 AA target-size minimum (2.5.8).
 */
export function HelpToggleTip({ title, children }: { title: string; children: ReactNode }) {
  return (
    // Count only opens (7a-4) — the control's help `title`, never brother data.
    <Popover.Root
      onOpenChange={(open) => {
        if (open) {
          trackHelpOpened(title);
        }
      }}
    >
      <Popover.Trigger
        aria-label={`Help: ${title}`}
        className="inline-grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-[var(--primary-emphasis)]"
      >
        <CircleHelp size={18} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          // A short read-only note, not a dialog: label the region so a screen
          // reader announces the tip when Radix moves focus to it on open.
          role="note"
          aria-label={`${title} — help`}
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-40 w-[280px] max-w-[80vw] rounded-xl border border-border bg-popover p-3.5 text-[length:var(--text-body-sm)] leading-relaxed text-popover-foreground shadow-[var(--shadow-popover)]"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
