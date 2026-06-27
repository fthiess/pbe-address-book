/**
 * `@pbe/name-search` — the Directory's Name-Search matcher (D35/D66/D110/D123).
 *
 * Pure logic, no DOM: the SPA's Web Worker and the offline phonetic A/B harness
 * build and query the identical index from this one module. The public surface:
 *
 *   - {@link buildIndex} / {@link NameIndex} — the full fuzzy + phonetic +
 *     nickname index (worker-built).
 *   - {@link substringMatch} — the immediate main-thread fallback before the
 *     worker's index is ready.
 *   - {@link highlightRanges} — character ranges to mark in a display name.
 *   - {@link tokenize}, {@link expandNickname}, {@link phoneticCodes} — the
 *     primitives, exported for the A/B harness and tests.
 *   - {@link DEFAULT_SEARCH_CONFIG} — the production knobs (phonetic algorithm +
 *     nickname expansion).
 */
export type {
  HighlightRange,
  NameRecord,
  PhoneticAlgorithm,
  SearchConfig,
} from "./types.js";
export { DEFAULT_SEARCH_CONFIG } from "./config.js";
export { tokenize, normalizeToken } from "./tokenize.js";
export { expandNickname } from "./nicknames.js";
export { phoneticCodes } from "./phonetic.js";
export { buildIndex, substringMatch, recordTokens, type NameIndex } from "./index-build.js";
export { highlightRanges } from "./highlight.js";
