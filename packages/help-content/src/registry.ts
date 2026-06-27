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
 */
export const helpContent: HelpContent = {
  "directory.search": {
    key: "directory.search",
    label: "Name Search",
    helperText: "Find brothers by name — first, middle, last, or mug name.",
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
