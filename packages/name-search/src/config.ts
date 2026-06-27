import type { SearchConfig } from "./types.js";

/**
 * The production Name-Search configuration. The phonetic algorithm is the one
 * **chosen by the build-time A/B harness** (D66) — an offline, recall-favoring
 * comparison of Double Metaphone vs Beider-Morse over the real roster, run
 * outside the repo so no real names are ever committed; the chosen value and the
 * reason it won are recorded in `DECISIONS.md`. The common-nickname expansion
 * (D123) ships **on by default**.
 *
 * Both are deliberately overridable: the worker and the harness accept any
 * {@link SearchConfig}, so re-running the experiment never requires touching the
 * matcher — only this default.
 */
export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  // Beider-Morse, chosen by the Phase 3b A/B over the real roster (N19): it won
  // the sound-alike/transliteration class decisively (98.7% vs Double Metaphone's
  // 95.7% recall) at equal precision, which is the international-names case that
  // made phonetic matching an MVP need (D35/D66). Its cost is worker-only (D110).
  phonetic: "beider-morse",
  nicknames: true,
};
