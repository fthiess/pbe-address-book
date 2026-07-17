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

import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "./grid-model.js";

/** Horizontal cell chrome to add to a measured data string: the `px-3` padding both sides. */
const CELL_PADDING = 24;
/**
 * Extra header chrome beyond the label text: the sort glyph, the reorder grip on
 * data columns, and the gaps — so an auto-fit never clips the header itself.
 */
const HEADER_CHROME = 64;
/** A course chip adds its pill padding + border around the code text. */
const CHIP_PADDING = 20;
/** The `gap-1` (4px) between adjacent course chips in a cell's chip strip. */
const CHIP_GAP = 4;

/** A function that returns the rendered pixel width of a string at a fixed font. */
export type TextMeasurer = (text: string) => number;

/**
 * Clamp a column to fit the larger of (its widest data content plus cell padding)
 * and (its header label plus header chrome), within the resize bounds. Shared by
 * the plain-text and chip-strip auto-fit paths so both round and clamp alike.
 */
function fitColumn(headerLabel: string, widestData: number, measure: TextMeasurer): number {
  const dataNeeded = widestData + CELL_PADDING;
  const headerNeeded = measure(headerLabel) + HEADER_CHROME;
  const needed = Math.ceil(Math.max(dataNeeded, headerNeeded));
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, needed));
}

/**
 * Auto-fit width for a plain-text column: the larger of (its header label plus
 * header chrome) and (its widest measured data value plus cell padding), clamped
 * to the resize bounds. The Course column, whose cells are chip strips rather
 * than plain text, has its own path — {@link autoFitChipStripWidth}.
 */
export function autoFitWidth(
  headerLabel: string,
  values: readonly string[],
  measure: TextMeasurer,
): number {
  let widestData = 0;
  for (const value of values) {
    const w = measure(value);
    if (w > widestData) {
      widestData = w;
    }
  }
  return fitColumn(headerLabel, widestData, measure);
}

/**
 * The rendered width of one brother's Course cell: every course code drawn as a
 * chip (its code text plus the pill's padding+border, {@link CHIP_PADDING}), with
 * a {@link CHIP_GAP} between adjacent chips (`gap-1`). An empty list contributes 0
 * — that brother shows a narrow em-dash placeholder, not a chip. Codes are
 * measured at the grid body font, a hair wider than the chips' `text-xs`, which
 * only adds harmless slack so a fitted column never clips.
 */
export function chipStripWidth(codes: readonly string[], measure: TextMeasurer): number {
  if (codes.length === 0) {
    return 0;
  }
  let total = (codes.length - 1) * CHIP_GAP;
  for (const code of codes) {
    total += measure(code) + CHIP_PADDING;
  }
  return total;
}

/**
 * Auto-fit width for the Course column, whose cell renders ALL of a brother's
 * courses as chips (OFC-269), not a single value. Fits the widest full chip strip
 * across the display set — so a double-click sizes the column to show every chip,
 * not just the primary course (OFC-277). `rows` is each row's course codes.
 */
export function autoFitChipStripWidth(
  headerLabel: string,
  rows: readonly (readonly string[])[],
  measure: TextMeasurer,
): number {
  let widestData = 0;
  for (const codes of rows) {
    const w = chipStripWidth(codes, measure);
    if (w > widestData) {
      widestData = w;
    }
  }
  return fitColumn(headerLabel, widestData, measure);
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
