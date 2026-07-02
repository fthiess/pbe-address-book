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

/**
 * A display word folded to its comparison form (as {@link normalizeToken} folds
 * query tokens: NFKD + strip diacritics + lowercase), paired with, for each
 * folded character, the source character's `[start, end)` offset span within the
 * original word. The span lets a match found in the *folded* string map back to
 * the exact characters to mark in the *original* string — necessary because
 * folding is not length-preserving (`"José"` → `"jose"` here happens to match,
 * but a ligature like `"ﬀ"` → `"ff"` does not).
 */
interface FoldedWord {
  folded: string;
  /** `spans[k]` = the source char offsets `[start, end)` of folded char `k`. */
  spans: { start: number; end: number }[];
}

/** Fold a display word character-by-character, tracking each folded char's origin. */
function foldWithOffsets(word: string): FoldedWord {
  let folded = "";
  const spans: { start: number; end: number }[] = [];
  let offset = 0;
  for (const char of word) {
    const start = offset;
    const end = offset + char.length; // UTF-16 length (handles surrogate pairs)
    for (const foldedChar of normalizeToken(char)) {
      folded += foldedChar;
      spans.push({ start, end });
    }
    offset = end;
  }
  return { folded, spans };
}

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
    // Fold the word the same way query tokens are folded (diacritics included),
    // so an accented display word ("José") still matches a folded query ("jose").
    // The offset map carries each folded-string hit back to the original chars —
    // this is what was missing before (OFC-102): the old length-preserving
    // lower-case never folded diacritics, so accented names got no character mark.
    const { folded, spans } = foldWithOffsets(word);

    // Character-level substring hits for any query token.
    let substringHit = false;
    for (const queryToken of queryTokens) {
      const subIndex = folded.indexOf(queryToken);
      // Map the folded [subIndex, subIndex+len) run back to original offsets:
      // the start of the first matched folded char, the end of the last. Both
      // spans exist whenever indexOf hit (spans.length === folded.length).
      const startSpan = spans[subIndex];
      const endSpan = spans[subIndex + queryToken.length - 1];
      if (subIndex >= 0 && startSpan && endSpan) {
        ranges.push({ start: at + startSpan.start, end: at + endSpan.end });
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
