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
}

export type HelpContent = Readonly<Record<string, HelpEntry>>;
