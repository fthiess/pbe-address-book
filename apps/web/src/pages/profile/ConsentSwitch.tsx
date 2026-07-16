import { Lock } from "lucide-react";
import { useId } from "react";
import { HelpToggleTip } from "../../components/HelpToggleTip.js";
import { cn } from "../../lib/utils.js";
import { activeConsequence, counterfactual, switchCopy } from "./consent.js";

/**
 * A privacy/consent switch (§5.7.3; COMPONENTS.md "Switch"). `role="switch"` with
 * `aria-checked`, a 42×24 track + 20px knob, the **active-side consequence inline**
 * and the **counterfactual in the `?` tip** (D113). Meaning never rides on colour
 * alone — the knob position, the on/off label weight, and the consequence *text*
 * all carry it (D32). The copy is resolved from the shared help-content registry by
 * `entryKey` (Phase 6b / D53); a switch entry may also carry a `toggleTip` with
 * richer context, shown beneath the counterfactual in the same popover.
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
        onClick={() => onChange?.(!value)}
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

      {!locked && (
        <HelpToggleTip title={`What changes if you flip “${copy.label}”`}>
          <p>{counterfactual(copy, value)}</p>
          {copy.toggleTip && (
            <p className="mt-2 border-t border-border pt-2 text-muted-foreground">
              {copy.toggleTip}
            </p>
          )}
        </HelpToggleTip>
      )}
    </div>
  );
}
