import { expandNickname } from "./nicknames.js";
import { normalizeToken, tokenize } from "./tokenize.js";
import type { HighlightRange, SearchConfig } from "./types.js";

/**
 * Compute the character ranges to mark in a **display name** for the current
 * query, so the eye finds the hit even within a name-sorted list (D35). This runs
 * on the main thread for the handful of *visible* (virtualized) rows only, so it
 * stays cheap and — deliberately — pulls in **none** of the heavy phonetic
 * libraries, which must stay off the Directory landing page (D74); those live
 * only in the worker's index. Highlighting is a cosmetic over results the worker
 * already chose, so it uses the light layers (substring, nickname, edit-distance):
 * a row matched purely by a far phonetic sound-alike still shows, it just may not
 * carry a mark on the matched word — an acceptable trade for a lean first load.
 *
 * It walks the display string word by word and marks a word when it matches a
 * query token. A direct prefix/substring hit is marked at the **character** level
 * ("Will" inside "William"); a nickname or near-typo hit marks the **whole** word.
 * Ranges are merged so overlapping marks render as one `<mark>`.
 */

/** Maximal runs of letters — the display's word spans, with their offsets. */
const WORD = /\p{L}+/gu;

export function highlightRanges(
  display: string,
  query: string,
  config: SearchConfig,
): HighlightRange[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || display.length === 0) {
    return [];
  }

  const ranges: HighlightRange[] = [];
  for (const match of display.matchAll(WORD)) {
    const word = match[0];
    const at = match.index ?? 0;
    const lower = word.toLocaleLowerCase(); // length-preserving, for substring offsets
    const folded = normalizeToken(word); // diacritic-folded, for fuzzy/phonetic compare

    // A word may be marked by more than one query token (e.g. a prefix hit and a
    // nickname hit); collect every match and let mergeRanges fold the overlaps.
    for (const queryToken of queryTokens) {
      const subIndex = lower.indexOf(queryToken);
      if (subIndex >= 0) {
        ranges.push({ start: at + subIndex, end: at + subIndex + queryToken.length });
      } else if (wordMatchesToken(folded, queryToken, config)) {
        ranges.push({ start: at, end: at + word.length });
      }
    }
  }

  return mergeRanges(ranges);
}

/** Word-level (non-substring) match: nickname group or a near-typo (edit distance). */
function wordMatchesToken(word: string, queryToken: string, config: SearchConfig): boolean {
  if (!word) {
    return false;
  }
  if (config.nicknames && new Set(expandNickname(queryToken)).has(word)) {
    return true;
  }
  return withinEditDistance(word, queryToken);
}

/**
 * A bounded edit-distance check (≤1 for short tokens, ≤2 for longer) — a cheap
 * stand-in for Fuse's typo tolerance, used only to decide whether to highlight a
 * word. Early-exits on a length gap larger than the budget.
 */
function withinEditDistance(a: string, b: string): boolean {
  const budget = Math.max(a.length, b.length) <= 4 ? 1 : 2;
  if (Math.abs(a.length - b.length) > budget) {
    return false;
  }
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      curr.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > budget) {
      return false; // whole row already exceeds the budget — no path can recover.
    }
    prev = curr;
  }
  return (prev[b.length] ?? Number.POSITIVE_INFINITY) <= budget;
}

/** Merge overlapping/adjacent ranges so the renderer emits one `<mark>` per run. */
function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length <= 1) {
    return ranges;
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: HighlightRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
