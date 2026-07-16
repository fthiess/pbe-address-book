/**
 * The shape of a single help-content entry — the one source shared by the
 * in-page help and the assembled USER-MANUAL so the two cannot drift
 * (DECISIONS D53; CODING-PROJECT-PLAN §10).
 *
 * Help is layered. An entry carries:
 *  - `label`      the persistent visible field label (always present);
 *  - `helperText` the persistent `aria-describedby` line a control needs to be
 *                 usable — the AA-baseline layer that ships with each page in
 *                 Phases 3–5 (D111);
 *  - `placeholder` an optional light example shown in the empty input;
 *  - `toggleTip`  the deeper "what is this / how do I use it" explanation
 *                 revealed by the `CircleHelp` popover — the above-baseline
 *                 (≈ AAA) enrichment wired in Phase 6 (D111).
 *
 * A **switch** entry additionally carries `whenOn`/`whenOff`: the two consequence
 * sentences a privacy/consent toggle states (D45/D113). The switch shows the one
 * matching its live value inline and the other — the *counterfactual* — in the
 * `?` popover (Phase 6b folded this copy off the interim `consent.ts` module into
 * the registry so the in-page help and the assembled USER-MANUAL share one source,
 * D53). These two fields are populated only by switch entries.
 *
 * Phase 0 ships the type and an empty registry; entries are authored as each
 * page is built.
 */
export interface HelpEntry {
  /** Stable control identifier, e.g. "directory.search" or "profile.classYear". */
  key: string;
  label: string;
  helperText?: string;
  placeholder?: string;
  toggleTip?: string;
  /** Switch only — the consequence shown inline (and in the `?`) when the toggle is on. */
  whenOn?: string;
  /** Switch only — the consequence shown inline (and in the `?`) when the toggle is off. */
  whenOff?: string;
}

export type HelpContent = Readonly<Record<string, HelpEntry>>;
