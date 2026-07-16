import { getHelpEntry } from "@pbe/help-content";

/**
 * The privacy & consent switch copy (§5.7.3, D45/D113). Each switch **states its
 * currently-true consequence inline** and puts the **counterfactual one tap away**
 * in the `?` toggle-tip — the transparent nudge that makes any opt-out an informed,
 * considered act (after Thaler & Sunstein). `whenOn`/`whenOff` are the two
 * consequence sentences; the component shows the one matching the live value inline
 * and the other in the `?` popover.
 *
 * Phase 6b folded this copy out of a local module and into the shared help-content
 * registry (D53/D111), so the in-page help and the assembled USER-MANUAL share one
 * source. This module now just resolves a switch's registry entry and computes the
 * active / counterfactual sides from it.
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
  /** Optional richer context shown beneath the counterfactual in the `?`. */
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

/** The opposite-side (counterfactual) consequence — what flipping it would do. */
export function counterfactual(
  copy: Pick<SwitchCopy, "whenOn" | "whenOff">,
  value: boolean,
): string {
  return value ? copy.whenOff : copy.whenOn;
}
