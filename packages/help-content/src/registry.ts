import type { HelpContent, HelpEntry } from "./types.js";

/**
 * The single help-content registry, keyed by stable control id. Empty in
 * Phase 0 — populated entry by entry as the Directory, Profile, and Admin
 * pages are built (Phases 3–5), then consumed by the Phase 6 manual-assembly
 * step. Both the running UI and the manual read from here.
 */
export const helpContent: HelpContent = {};

/** Look up a help entry by its control id, or `undefined` if none is defined. */
export function getHelpEntry(key: string): HelpEntry | undefined {
  return helpContent[key];
}
