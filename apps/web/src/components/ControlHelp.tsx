import { getHelpEntry } from "@pbe/help-content";
import { HelpToggleTip } from "./HelpToggleTip.js";

/**
 * The registry-driven drop-in `?` for a non-switch control: looks the entry up by
 * id and renders a {@link HelpToggleTip} carrying its `toggleTip`, titled with the
 * entry's label. Renders **nothing** when the entry has no `toggleTip`, so a call
 * site can wire it unconditionally and a tip appears only where one is authored.
 * (Switches compose their own popover from `whenOn`/`whenOff` plus any `toggleTip`,
 * so they use {@link HelpToggleTip} directly rather than this.)
 */
export function ControlHelp({ entryKey }: { entryKey: string }) {
  const entry = getHelpEntry(entryKey);
  if (!entry?.toggleTip) {
    return null;
  }
  return (
    <HelpToggleTip title={entry.label}>
      <p>{entry.toggleTip}</p>
    </HelpToggleTip>
  );
}
