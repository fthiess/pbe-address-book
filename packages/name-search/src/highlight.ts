import { normalizeToken, tokenize } from "./tokenize.js";
import type { HighlightRange } from "./types.js";

/**
 * Compute the character ranges to mark in a **display string** (a name-column
 * cell) for the current query (D35). Highlighting follows the *actual* match the
 * worker found: `matchedTokens` is the set of this brother's folded name tokens
 * that the worker's index matched (across exact, typo, nickname, AND Beider-Morse
 * phonetics — see `searchDetailed`). The main thread therefore highlights the
 * right words across **every** name column without loading any phonetic library
 * (BM/talisman/Fuse stay worker-only, off the landing page — D74).
 *
 * Two layers, per display word:
 *   - a **direct substring** of a query token is marked at the **character** level
 *     ("Will" inside "William"), so prefix/substring typing reads precisely;
 *   - otherwise, if the word's folded form is one the worker matched, the **whole
 *     word** is marked (the nickname / phonetic / typo case).
 *
 * Before the worker is ready the caller passes no `matchedTokens`, so only the
 * substring layer fires — which is exactly what the main-thread fallback matches.
 */

/** Maximal runs of letters — the display's word spans, with their offsets. */
const WORD = /\p{L}+/gu;

export function highlightRanges(
  display: string,
  query: string,
  matchedTokens?: ReadonlySet<string>,
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

    // Character-level substring hits for any query token.
    let substringHit = false;
    for (const queryToken of queryTokens) {
      const subIndex = lower.indexOf(queryToken);
      if (subIndex >= 0) {
        ranges.push({ start: at + subIndex, end: at + subIndex + queryToken.length });
        substringHit = true;
      }
    }

    // Otherwise, a whole-word mark if the worker matched this word (folded).
    if (!substringHit && matchedTokens?.has(normalizeToken(word))) {
      ranges.push({ start: at, end: at + word.length });
    }
  }

  return mergeRanges(ranges);
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
