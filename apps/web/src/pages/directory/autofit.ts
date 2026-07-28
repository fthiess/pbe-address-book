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
 * A search-highlight `<mark>` carries `px-px` — 1px of padding on each side — so a
 * highlighted cell renders 2px wider per mark than its text measures (OFC-358).
 * Small, but auto-fit leaves no slack at all, so unaccounted pixels clip.
 */
const MARK_PADDING = 2;
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
 * What one cell actually renders: its display text, plus how many search-highlight
 * `<mark>` spans are drawn inside it. The mark count matters because each one adds
 * {@link MARK_PADDING} of width that measuring the text alone cannot see — so a
 * column auto-fitted while a search is running would come out short (OFC-358).
 */
export interface CellContent {
  /** The cell's rendered display text. */
  text: string;
  /** Highlight marks rendered within that text; absent or 0 for an unsearched cell. */
  marks?: number;
}

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
  cells: readonly CellContent[],
  measure: TextMeasurer,
): number {
  let widestData = 0;
  for (const cell of cells) {
    const w = measure(cell.text) + (cell.marks ?? 0) * MARK_PADDING;
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

/**
 * The Canonical Name link renders at `font-medium` — weight 500 (DirectoryGrid's
 * name cell) — where every other cell renders at the body weight. Measuring a name
 * at 400 under-measures it by a few pixels, which is exactly enough for an
 * auto-fitted Name column to clip the longest names (OFC-358). ⚠ Keep this in step
 * with that class: the measurement and the render have to describe the same text.
 */
const NAME_CELL_FONT_WEIGHT = 500;

/**
 * The effective CSS font of a column's body cells, for the measurer (matches
 * `text-sm`). Pass the column key so the Name column is measured at the weight it
 * actually renders; omit it for the body weight every other column uses.
 */
export function gridCellFont(key?: ColumnKey): string {
  const weight = key === "name" ? `${NAME_CELL_FONT_WEIGHT} ` : "";
  if (typeof getComputedStyle === "undefined" || typeof document === "undefined") {
    return `${weight}14px sans-serif`;
  }
  const body = getComputedStyle(document.body);
  // The grid is 14px (`text-sm`) in the body font stack, regardless of body size.
  return `${weight}14px ${body.fontFamily || "sans-serif"}`;
}
