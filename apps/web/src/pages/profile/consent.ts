/**
 * Plain-language copy for the privacy & consent switches (§5.7.3, D45/D113).
 *
 * Each switch **states its currently-true consequence inline** and puts the
 * **counterfactual one tap away** in the `?` toggle-tip — the transparent nudge
 * that makes any opt-out an informed, considered act (after Thaler & Sunstein).
 * `whenOn`/`whenOff` are the two consequence sentences; the component shows the
 * one matching the live value inline and the other in the `?` popover.
 *
 * Copy accuracy note (flagged for the gate): the off-state of a *toggle* field
 * hides it from **other brothers and managers** — only administrators (and the
 * owner) see through an off toggle (the D16/D19 narrowing in `visibility.ts`).
 * The wording here says "other brothers" — the always-true, trust-keeping effect
 * — rather than enumerating which staff role can still see it.
 *
 * The deeper `?` enrichment is folded into the shared help-content registry (and
 * the assembled USER-MANUAL) in Phase 6 (D53/D111); this is the live 4a source.
 */

export interface ConsentCopy {
  /** Accessible name for the switch — stable regardless of position. */
  label: string;
  /** Consequence shown when the underlying boolean is `true`. */
  whenOn: string;
  /** Consequence shown when the underlying boolean is `false`. */
  whenOff: string;
}

/** The active-side (inline) consequence for the switch's current value. */
export function activeConsequence(copy: ConsentCopy, value: boolean): string {
  return value ? copy.whenOn : copy.whenOff;
}

/** The opposite-side (counterfactual) consequence — what flipping it would do. */
export function counterfactual(copy: ConsentCopy, value: boolean): string {
  return value ? copy.whenOff : copy.whenOn;
}

/** The five per-field visibility toggles (DATABASE-SCHEMA §3; defaults in `PrivacyFlags`). */
export const PRIVACY_COPY: Record<
  "shareEmail" | "shareAddress" | "sharePhone" | "shareEmergency" | "shareSpousePartner",
  ConsentCopy
> = {
  shareEmail: {
    label: "Share email with brothers",
    whenOn: "Brothers can reach you by email.",
    whenOff: "Your email is hidden from other brothers.",
  },
  shareAddress: {
    label: "Share address with brothers",
    whenOn: "Your mailing address is visible to brothers.",
    whenOff: "Your mailing address is hidden from other brothers.",
  },
  sharePhone: {
    label: "Share phone with brothers",
    whenOn: "Your phone number is visible to brothers.",
    whenOff: "Your phone number is hidden from other brothers.",
  },
  shareEmergency: {
    label: "Share emergency contacts with brothers",
    whenOn: "Your emergency contacts are visible to brothers.",
    whenOff: "Visible to administrators only.",
  },
  shareSpousePartner: {
    label: "Share spouse / partner with brothers",
    whenOn: "Your spouse / partner is visible to brothers.",
    whenOff: "Shown to administrators only.",
  },
};

/** The three consent flags + the self-service directory-listing switch (top-level booleans). */
export const CONSENT_COPY: Record<
  "allowNewsletterEmail" | "allowCommentReplyEmail" | "allowShareWithMITAA" | "listed",
  ConsentCopy
> = {
  allowNewsletterEmail: {
    label: "PBE News newsletter",
    whenOn: "You will receive PBE News by email.",
    whenOff: "You don't receive PBE News by email.",
  },
  allowCommentReplyEmail: {
    label: "Comment-reply emails",
    whenOn: "You're emailed when someone replies to your comments.",
    whenOff: "You're not emailed about replies to your comments.",
  },
  allowShareWithMITAA: {
    label: "Share with the MIT Alumni Association",
    whenOn: "May be shared with the MIT Alumni Association.",
    whenOff: "Will not be shared with the MIT Alumni Association.",
  },
  // Presented as the positive "Listed in the directory" (on = listed/visible), so
  // it reads like every other privacy switch — the stored field stays `unlisted`,
  // inverted at the call site (N35). `listed` true is the visible state.
  listed: {
    label: "Listed in the directory",
    whenOn: "You appear in the directory for all brothers.",
    whenOff:
      "You don't appear in the directory for other brothers; managers and administrators can still see your record.",
  },
};
