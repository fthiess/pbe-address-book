import { Lock } from "lucide-react";
import { useId } from "react";
import { ControlHelp } from "../../components/ControlHelp.js";
import { trackConsentToggleChanged } from "../../lib/analytics.js";
import { cn } from "../../lib/utils.js";
import { activeConsequence, switchCopy } from "./consent.js";

/**
 * A privacy/consent switch (§5.7.3; COMPONENTS.md "Switch"). `role="switch"` with
 * `aria-checked`, a 42×24 track + 20px knob, and the **active-side consequence
 * inline** (D113). Meaning never rides on colour alone — the knob position, the
 * on/off label weight, and the consequence *text* all carry it (D32). The copy is
 * resolved from the shared help-content registry by `entryKey` (D53).
 *
 * A switch's `?` shows only the entry's static `toggleTip` (richer context) and so
 * appears only where one is authored — MITAA and Listed today (Phase 6b live-test,
 * N103): the earlier counterfactual-in-`?` was redundant with the inline consequence
 * for the per-field switches, so it was dropped and the `?` unified onto the same
 * `ControlHelp` the fields use.
 *
 * `locked` renders the manager's read-only view of the restricted block (§5.7.2):
 * the value is shown with a lock affordance and is non-interactive.
 */
export function ConsentSwitch({
  entryKey,
  value,
  onChange,
  locked = false,
}: {
  entryKey: string;
  value: boolean;
  onChange?: (next: boolean) => void;
  locked?: boolean;
}) {
  const copy = switchCopy(entryKey);
  const labelId = useId();
  const inline = activeConsequence(copy, value);

  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-labelledby={labelId}
        disabled={locked}
        onClick={() => {
          if (!onChange) {
            return;
          }
          // A brother's own choice about his own data — the toggle key and its new
          // state, no P6 concern (7a-4/D145). Only actionable switches emit; the
          // read-only/locked manager view has no `onChange` and stays silent.
          trackConsentToggleChanged(entryKey, !value);
          onChange(!value);
        }}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-[42px] shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          value ? "bg-primary" : "bg-[var(--track)]",
          locked && "cursor-default opacity-70",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-5 rounded-full bg-white shadow transition-transform",
            value ? "translate-x-[20px]" : "translate-x-0.5",
          )}
        />
      </button>

      <div className="min-w-0 flex-1">
        <p
          id={labelId}
          className={cn(
            "text-[length:var(--text-body)]",
            value ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {locked && (
            <Lock
              size={14}
              aria-hidden="true"
              className="mr-1 inline align-[-0.15em] text-muted-foreground"
            />
          )}
          {inline}
          <span className="sr-only"> — {copy.label}</span>
        </p>
      </div>

      {!locked && <ControlHelp entryKey={entryKey} />}
    </div>
  );
}
