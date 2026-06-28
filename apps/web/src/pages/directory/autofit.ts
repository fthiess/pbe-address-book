/**
 * Double-click-to-auto-fit column widths (N27) — the spreadsheet gesture, made
 * practical here because the whole dataset is in memory (D4): the widest value is
 * found by measuring every row's display string with a canvas `measureText`
 * against the column's font — cheap and synchronous (~1,200 rows is sub-ms, no
 * layout thrash) — which also sidesteps virtualization (only ~30 rows are in the
 * DOM, so DOM measurement of all rows is impossible).
 *
 * The width arithmetic is a pure function over an injected text measurer, so it
 * is unit-tested without a canvas; the DOM measurer is a thin adapter.
 */

import { type ColumnKey, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "./grid-model.js";

/** Horizontal cell chrome to add to a measured data string: the `px-3` padding both sides. */
const CELL_PADDING = 24;
/**
 * Extra header chrome beyond the label text: the sort glyph, the reorder grip on
 * data columns, and the gaps — so an auto-fit never clips the header itself.
 */
const HEADER_CHROME = 64;
/** A course chip adds its pill padding + border around the code text. */
const CHIP_PADDING = 20;

/** A function that returns the rendered pixel width of a string at a fixed font. */
export type TextMeasurer = (text: string) => number;

/**
 * Compute the auto-fit width for a column: the larger of (its header label plus
 * header chrome) and (its widest data value plus cell padding), clamped to the
 * resize bounds. `extraPerValue` covers non-plain-text cells (the Course chip).
 */
export function autoFitWidth(
  headerLabel: string,
  values: readonly string[],
  measure: TextMeasurer,
  extraPerValue = 0,
): number {
  let widestData = 0;
  for (const value of values) {
    const w = measure(value) + extraPerValue;
    if (w > widestData) {
      widestData = w;
    }
  }
  const dataNeeded = widestData + CELL_PADDING;
  const headerNeeded = measure(headerLabel) + HEADER_CHROME;
  const needed = Math.ceil(Math.max(dataNeeded, headerNeeded));
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, needed));
}

/** Per-value chip/decoration padding for the columns whose cells aren't plain text. */
export function extraWidthFor(key: ColumnKey): number {
  return key === "major" ? CHIP_PADDING : 0;
}

/**
 * Build a canvas-backed measurer at the given CSS font (N24: measured at the
 * *current* root font size, so a font-size change is re-triggered by the user).
 * Falls back to a rough per-character estimate where no 2D context is available
 * (non-browser test envs) so callers never have to special-case it.
 */
export function makeTextMeasurer(font: string): TextMeasurer {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = canvas?.getContext("2d") ?? null;
  if (!ctx) {
    return (text: string) => text.length * 8;
  }
  ctx.font = font;
  return (text: string) => ctx.measureText(text).width;
}

/** The effective CSS font of the grid body cells, for the measurer (matches `text-sm`). */
export function gridCellFont(): string {
  if (typeof getComputedStyle === "undefined" || typeof document === "undefined") {
    return "14px sans-serif";
  }
  const body = getComputedStyle(document.body);
  // The grid is 14px (`text-sm`) in the body font stack, regardless of body size.
  return `14px ${body.fontFamily || "sans-serif"}`;
}
