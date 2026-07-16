import { getHelpEntry } from "@pbe/help-content";

/**
 * The privacy & consent switch copy (§5.7.3, D45/D113). Each switch **states its
 * currently-true consequence inline** — `whenOn`/`whenOff` are the two consequence
 * sentences and the component shows the one matching the live value. (The earlier
 * counterfactual-in-`?` was dropped as redundant with the inline consequence — N103;
 * a switch's `?` now carries only its optional static `toggleTip`.)
 *
 * Phase 6b folded this copy out of a local module and into the shared help-content
 * registry (D53/D111), so the in-page help and the assembled USER-MANUAL share one
 * source. This module now just resolves a switch's registry entry and computes the
 * active consequence from it.
 *
 * Copy accuracy note: the off-state of a *toggle* field hides it from **other
 * brothers and managers** — only administrators (and the owner) see through an off
 * toggle (the D16/D19 narrowing in `visibility.ts`). The wording says "other
 * brothers" — the always-true, trust-keeping effect — rather than enumerating which
 * staff role can still see it.
 */

/** The resolved copy a {@link SwitchCopy}-driven control renders. */
export interface SwitchCopy {
  /** Accessible name for the switch — stable regardless of position. */
  label: string;
  /** Consequence shown when the underlying boolean is `true`. */
  whenOn: string;
  /** Consequence shown when the underlying boolean is `false`. */
  whenOff: string;
  /** Optional richer context shown in the `?` (the switch's only tip content, N103). */
  toggleTip?: string;
}

/** The stable registry ids of the eight privacy/consent switches. */
export const SWITCH_KEYS = {
  shareEmail: "profile.privacy.shareEmail",
  shareAddress: "profile.privacy.shareAddress",
  sharePhone: "profile.privacy.sharePhone",
  shareEmergency: "profile.privacy.shareEmergency",
  shareSpousePartner: "profile.privacy.shareSpousePartner",
  allowShareWithMITAA: "profile.consent.allowShareWithMITAA",
  allowNewsletterEmail: "profile.consent.allowNewsletterEmail",
  listed: "profile.consent.listed",
} as const;

/**
 * Resolve a switch's registry entry into its copy. A missing entry — or one lacking
 * the switch `whenOn`/`whenOff` fields — is a programming error (a bad key or a
 * registry that fell out of sync), so this throws rather than rendering a blank.
 */
export function switchCopy(key: string): SwitchCopy {
  const entry = getHelpEntry(key);
  if (!entry || entry.whenOn === undefined || entry.whenOff === undefined) {
    throw new Error(`Missing or non-switch help entry: ${key}`);
  }
  return {
    label: entry.label,
    whenOn: entry.whenOn,
    whenOff: entry.whenOff,
    toggleTip: entry.toggleTip,
  };
}

/** The active-side (inline) consequence for the switch's current value. */
export function activeConsequence(
  copy: Pick<SwitchCopy, "whenOn" | "whenOff">,
  value: boolean,
): string {
  return value ? copy.whenOn : copy.whenOff;
}
