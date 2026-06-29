import type { HelpContent, HelpEntry } from "./types.js";

/**
 * The single help-content registry, keyed by stable control id. Populated entry
 * by entry as the Directory, Profile, and Admin pages are built (Phases 3–5),
 * then consumed by the Phase 6 manual-assembly step. Both the running UI and the
 * manual read from here. The **baseline** layer (label + helper text — the AA
 * instructions a control needs to be usable, D111) ships with each page in its
 * phase; the deeper `toggleTip` enrichment is wired in Phase 6.
 *
 * Phase 3a — the Directory grid's baseline controls.
 *
 * PHASE 6 PICKUP (do not forget): the Profile page's privacy/consent switch copy
 * — the inline active-side consequence AND the `?` counterfactual — currently
 * lives in `apps/web/src/pages/profile/consent.ts` (the live 4a source), and the
 * Profile field helper texts are inline in `apps/web/src/pages/profile/`. Phase 6
 * must fold that copy into THIS registry (label + helperText = on-consequence;
 * toggleTip = off-consequence) so the in-page help and the assembled USER-MANUAL
 * share one source (D53), and replace the interim native-`<details>` `HelpTip`
 * with the standard Radix `CircleHelp` toggle-tip used across every page (the
 * plan's Phase 6 §149).
 */
export const helpContent: HelpContent = {
  "directory.search": {
    key: "directory.search",
    label: "Name Search",
    // Accurate to the field's real function (D35/D123): name fields only, with
    // typo, sound-alike, and common-nickname tolerance. The placeholder stays
    // short so it never clips inside the field (placeholders can't scroll); the
    // example and capabilities live in helperText, never carried as essential
    // instructions in the placeholder (D111/§5.9).
    helperText:
      "Find brothers by name — handles typos, sound-alikes, and nicknames (Bill finds William).",
    placeholder: "Search by name…",
  },
  "directory.columns": {
    key: "directory.columns",
    label: "Columns",
    helperText: "Choose which columns appear; drag a column header's grip to reorder.",
  },
};

/** Look up a help entry by its control id, or `undefined` if none is defined. */
export function getHelpEntry(key: string): HelpEntry | undefined {
  return helpContent[key];
}
